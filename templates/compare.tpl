% rebase('base.tpl')
% has_b = bool(data.get('b_name')) or any((data.get('rows', {}).get(k, {}).get('b') or '') for k, _, _ in rows)
<div class="page-head no-print">
  <div>
    <h1>{{cmp['title'] or '对比清单'}}</h1>
    <p class="sub">截图发给客户，或者打印成 PDF。</p>
  </div>
  <div class="actions">
    <button type="button" class="btn btn-primary" data-print>打印 / 存为 PDF</button>
    <a class="btn" href="/compare/{{cmp['id']}}/edit">修改</a>
    <a class="btn" href="/products/{{p['id']}}">返回产品卡</a>
    <form method="post" action="/compare/{{cmp['id']}}/delete" class="inline-form" data-confirm="删除这份对比清单？">
      <input type="hidden" name="_csrf" value="{{csrf}}">
      <button type="submit" class="btn btn-danger">删除</button>
    </form>
  </div>
</div>

<section class="card flush">
  <div class="pcard-head"><h2>学车报价对比清单</h2></div>
  <div class="table-wrap">
  <table class="table cmp rows">
    <thead><tr><th>比较项目</th><th>我们：{{p['name'] or '班型'}}</th><th>{{data.get('a_name') or '对方 A'}}</th>
% if has_b:
      <th>{{data.get('b_name') or '对方 B'}}</th>
% end
      <th>口径</th></tr></thead>
    <tbody>
% for key, label, fields in rows:
%   r = data.get('rows', {}).get(key, {})
      <tr>
        <td class="nowrap r-main"><strong>{{label}}</strong></td>
        <td class="ours r-full {{'pending' if PENDING in ours[key] else ''}}"><span class="r-label">我们：</span>{{ours[key]}}</td>
        <td class="r-full"><span class="r-label">{{data.get('a_name') or '对方 A'}}：</span>{{nl2br(r.get('a') or '—')}}</td>
%   if has_b:
        <td class="r-full"><span class="r-label">{{data.get('b_name') or '对方 B'}}：</span>{{nl2br(r.get('b') or '—')}}</td>
%   end
        <td class="nowrap">
%   if r.get('same') == '一致':
          <span class="chip chip-green">一致</span>
%   elif r.get('same') == '不一致':
          <span class="chip chip-red">不一致</span>
%   elif r.get('same'):
          <span class="chip">{{r.get('same')}}</span>
%   end
        </td>
      </tr>
% end
    </tbody>
  </table>
  </div>
  <div class="pcard-foot">比较项目一致了，才是在做选择。对方信息来自客户提供的报价，以对方正式合同为准。</div>
</section>
