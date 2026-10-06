// 日期用 'YYYY-MM-DD' 字符串。“今天”以云函数返回的为准（固定按东八区算），这里只做加减。
function pad(n) { return n < 10 ? '0' + n : String(n); }

function add(day, n) {
  const d = new Date(String(day).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

module.exports = { add: add };
