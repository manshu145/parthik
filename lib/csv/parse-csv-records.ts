export type CsvParseResult = { success: true; rows: string[][] } | { success: false; error: string };

/**
 * Parse ordinary CSV records, including commas and line breaks inside quoted fields,
 * and escaped quotes represented by two double quotes.
 */
export function parseCsvRecords(input: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let insideQuotes = false;
  let closedQuote = false;

  const finishRow = () => {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    field = '';
    closedQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';

    if (insideQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          insideQuotes = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === ',') {
      row.push(field.trim());
      field = '';
      closedQuote = false;
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      finishRow();
      continue;
    }

    if (char === '"') {
      if (field.trim().length > 0 || closedQuote) {
        return { success: false, error: 'A quote appeared inside an unquoted field.' };
      }
      field = '';
      insideQuotes = true;
      continue;
    }

    if (closedQuote) {
      if (/\S/.test(char)) {
        return { success: false, error: 'Unexpected text after a closing quote.' };
      }
      continue;
    }

    field += char;
  }

  if (insideQuotes) {
    return { success: false, error: 'CSV contains an unterminated quoted field.' };
  }

  if (field.length > 0 || row.length > 0) finishRow();

  return { success: true, rows };
}
