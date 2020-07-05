/*
 * qif2csv
 * https://github.com/fza/qif2csv
 *
 * Copyright (c) 2019 Felix Zandanel
 * Licensed under the MIT license.
 */


const fs = require('fs');
const jschardet = require('jschardet');
const Iconv = require('iconv-lite');
const fecha = require('fecha');
const debug = require('debug')('qif2csv');
const csvWriter = require('csv-writer');

const US_DATE_FORMATS = ['MM-DD-YYYYHH:mm:ss', 'MM-DD-YYYY', 'MM-DD-YY'];
const UK_DATE_FORMATS = ['DD-MM-YYYYHH:mm:ss', 'DD-MM-YYYY', 'DD-MM-YY'];

function parseDate(dateStr, formats) {
  if (formats === 'us') {
    formats = US_DATE_FORMATS;
  }
  if (!formats) {
    formats = UK_DATE_FORMATS;
  }
  formats = [].concat(formats);

  let str = dateStr.replace(/ /g, '');
  str = str.replace(/\//g, '-');
  str = str.replace(/'/g, '-');
  str = str.replace(/\./g, '-');
  str = str.replace(/(^|[^0-9])([0-9])([^0-9]|$)/g, '$10$2$3');
  debug(`input date ${dateStr} became ${str}`);

  while (formats.length) {
    const format = formats.shift();
    const formatted = fecha.parse(str, format);

    if (formatted) {
      debug(`input date ${str} parses correctly with ${format}`);
      return fecha.format(formatted, 'DD.MM.YYYY');
      //return fecha.format(formatted, 'YYYY-MM-DDTHH:mm:ss');
    }
  }

  return `<invalid date:"${dateStr}">`;
}

exports.parse = function parse(qif, options) {
  /* eslint no-multi-assign: "off", no-param-reassign: "off", no-cond-assign: "off",
      no-continue: "off", prefer-destructuring: "off", no-case-declarations: "off" */

  const lines = qif.split('\n');
  let lineNum = 0;

  const data = {};

  const transactions = data.transactions = [];
  let transaction = {};

  let initialized = false;

  options = options || {};

  let division = {};

  while (line = lines.shift()) {
    lineNum++;
    line = line.trim();

    if (!initialized) {
      switch (line) {
        // Date format set in header -> override
        case '!Option:MDY':
          options.dateFormat = 'us';
          break;
        case '!Option:DMY':
          options.dateFormat = 'uk';
          break;
        case '!Type:Bank':
          data.type = 'Bank';
          initialized = true;
          break;
      }

      // Ignore other headers, but throw when there are any headers after data part began
      if (line[0] !== '!') {
        throw new Error(`Malformed QIF at line: ${lineNum}`);
      }

      continue;
    }

    if (line === '^') {
      transactions.push(transaction);
      transaction = {};
      continue;
    }

    switch (line[0]) {
      case 'D':
        transaction.date = parseDate(line.substring(1), options.dateFormat);
        break;
      case 'T':
        transaction.amount = parseFloat(line.substring(1).replace(',', ''));
        break;
      case 'U':
        // Looks like a legacy repeat of 'T'
        break;
      case 'N':
        transaction.number = line.substring(1);
        break;
      case 'M':
        transaction.memo = line.substring(1);
        break;
      case 'A':
        transaction.address = (transaction.address || []).concat(line.substring(1));
        break;
      case 'P':
        transaction.payee = line.substring(1).replace(/&amp;/g, '&');
        break;
      case 'L':
        const lArray = line.substring(1).split(':');
        transaction.category = lArray[0];
        if (lArray[1] !== undefined) {
          transaction.subcategory = lArray[1];
        }
        break;
      case 'C':
        transaction.clearedStatus = line.substring(1);
        break;
      case 'S':
        const sArray = line.substring(1).split(':');
        division.category = sArray[0];
        if (sArray[1] !== undefined) {
          division.subcategory = sArray[1];
        }
        break;
      case 'E':
        division.description = line.substring(1);
        break;
      case '$':
        division.amount = parseFloat(line.substring(1));
        if (!(transaction.division instanceof Array)) {
          transaction.division = [];
        }
        transaction.division.push(division);
        division = {};

        break;

      default:
        throw new Error(`Unknown Detail Code: ${line[0]}`);
    }
  }

  if (Object.keys(transaction).length) {
    transactions.push(transaction);
  }

  return data;
};

exports.parseInput = function parseInput(qifData, options, callback) {
  const { encoding } = jschardet.detect(qifData);
  let err;

  if (!callback) {
    callback = options;
    options = {};
  }

  if (encoding.toUpperCase() !== 'UTF-8' && encoding.toUpperCase() !== 'ASCII') {
    qifData = Iconv.decode(Buffer.from(qifData), encoding);
  } else {
    qifData = qifData.toString('utf8');
  }

  try {
    qifData = exports.parse(qifData, options);
  } catch (e) {
    err = e;
  }

  callback(err || undefined, qifData);
};

exports.parseStream = function parseStream(stream, options, callback) {
  let qifData = '';
  if (!callback) {
    callback = options;
    options = {};
  }
  stream.on('data', (chunk) => {
    qifData += chunk;
  });
  stream.on('end', () => {
    exports.parseInput(qifData, options, callback);
  });
};

exports.parseFile = function parseFile(qifFile, options, callback) {
  if (!callback) {
    callback = options;
    options = {};
  }
  fs.readFile(qifFile, (err, qifData) => {
    if (err) {
      return callback(err);
    }
    return exports.parseInput(qifData, options, callback);
  });
};

exports.createCsv = function createCsv(data) {
  const recordDelimiter = "\r\n";

  const csv = csvWriter.createObjectCsvStringifier({
    header: [
      {id: 'date', title: 'Datum'},
      {id: 'amount', title: 'Betrag'},
      {id: 'clearedStatus', title: 'Gebucht'},
      {id: 'number', title: 'Buchungsnummer'},
      {id: 'payee', title: 'Empfänger'},
      {id: 'memo', title: 'Buchungstext'}
    ],
    fieldDelimiter: ';',
    recordDelimiter: recordDelimiter,
    alwaysQuote: true
  });

  return csv.getHeaderString() + csv.stringifyRecords(data.transactions);
};
