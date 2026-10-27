// Correct cell reader: Date checked BEFORE generic object test.
const V = c => {
  let v = c && c.value;
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (v && typeof v === 'object') {
    if (v.hyperlink !== undefined && v.text !== undefined) return String(v.text).trim();
    if (v.result instanceof Date) return v.result.toISOString().slice(0,10);
    v = v.result ?? v.text ?? (v.richText ? v.richText.map(t=>t.text).join('') : '');
  }
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return v == null ? '' : String(v).trim();
};
module.exports = { V };
