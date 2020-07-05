#!/usr/bin/env node

const qif2csv = require('./lib/qif2csv.js');

const args = process.argv.slice(2);
let transactionsOnly;
let file;
let dateFormat;

while (args.length > 0) {
  const arg = args.shift();
  if (arg.indexOf('-') !== 0) {
    file = arg;
    continue;
  }
  switch (arg) {
    case '--transactions':
    case '-t':
      transactionsOnly = true;
      break;
    case '--date-format':
    case '-d':
      dateFormat = args.shift().split(',');
      break;
    default:
      break;
  }
}

function output(err, data) {
  let finalData = data;
  if (err) {
    console.error(err.message);
    return;
  }

  if (transactionsOnly) {
    finalData = data.transactions;
  }

  console.log(JSON.stringify(finalData, null, 4));
}

if (!file) {
  qif2csv.parseStream(process.stdin, { dateFormat }, output);
  process.stdin.resume();
} else {
  qif2csv.parseFile(file, { dateFormat }, function(err, data) {
    if (err) {
      console.error(err.message);
      return;
    }

    let finalData = qif2csv.createCsv(data);

    console.log(finalData);
  });
}
