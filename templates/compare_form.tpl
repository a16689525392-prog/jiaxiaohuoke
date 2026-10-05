% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>对比清单：{{p['name'] or '未命名班型'}}</h1>
    <p class="sub">把对方的报价按同样的项目填进来。比较项目一致了，客户才是在做选择，而不是被一个看起来很低的数字带着走。</p>
  </div>
</div>
<form method="post" action="{{'/compare/%d/edit' % cmp['id'] if cmp is not None else '/products/%d/compare/new' % p['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <div class="form-grid-3">
      <label class="field"><span>标题（给自己看的）</span>
        <input type="text" name="title" value="{{cmp['title'] if cmp is not None else ''}}" maxlength="60" placeholder="例如：小李 · 对比 ××驾校"></label>
      <label class="field"><span>对方 A（驾校和班型）</span>
        <input type="text" name="a_name" value="{{data.get('a_name', '')}}" maxlength="60"></label>
      <label class="field"><span>对方 B（没有可不填）</span>
        <input type="text" name="b_name" value="{{data.get('b_name', '')}}" maxlength="60"></label>
    </div>
  </section>
  <section class="card flush">
    <div class="table-wrap">
    <table class="table cmp rows">
      <thead><tr><th>比较项目</th><th>我们（取自产品卡）</th><th>对方 A</th><th>对方 B</th><th>口径是否一致</th></tr></thead>
      <tbody>
% for key, label, fields in rows:
%   r = data.get('rows', {}).get(key, {})
        <tr>
          <td class="nowrap r-main"><strong>{{label}}</strong></td>
          <td class="ours r-full {{'pending' if PENDING in ours[key] else ''}}"><span class="r-label">我们：</span>{{ours[key]}}</td>
          <td class="r-full"><span class="r-label">对方 A</span><textarea name="a_{{key}}" rows="2" maxlength="500" aria-label="对方 A：{{label}}">{{r.get('a', '')}}</textarea></td>
          <td class="r-full"><span class="r-label">对方 B</span><textarea name="b_{{key}}" rows="2" maxlength="500" aria-label="对方 B：{{label}}">{{r.get('b', '')}}</textarea></td>
          <td><select name="same_{{key}}" aria-label="口径是否一致：{{label}}">
              <option value="">—</option>
%   for o in options:
              <option value="{{o}}" {{'selected' if r.get('same') == o else ''}}>{{o}}</option>
%   end
            </select></td>
        </tr>
% end
      </tbody>
    </table>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="/products/{{p['id']}}">取消</a>
  </div>
</form>
