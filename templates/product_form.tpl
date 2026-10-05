% rebase('base.tpl')
% val = lambda k, d: (f.raw(k) if posted else (p[k] if p is not None else d))
<div class="page-head">
  <div>
    <h1>{{'编辑产品卡' if p is not None else '新增班型'}}</h1>
    <p class="sub">用普通人听得懂的话写。还没核实的保留“{{PENDING}}”，对着合作协议、合同和收费项目表核实后再改；不为了成交随口承诺。</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end

<form method="post" action="{{'/products/%d/edit' % p['id'] if p is not None else '/products/new'}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
% for section, fields in sections:
  <section class="card">
    <h2>{{section}}</h2>
    <div class="form-grid">
%   for key, label, default, example, hint, kind in fields:
%     v = val(key, default) or ''
%     cls = 'is-pending' if PENDING in v else ''
      <label class="field {{'wide' if kind == 'long' else ''}}"><span>{{label}}</span>
%     if kind == 'long':
        <textarea name="{{key}}" rows="2" maxlength="1000" class="{{cls}}" placeholder="例如：{{example}}">{{v}}</textarea>
%     elif kind == 'date':
        <input type="date" name="{{key}}" value="{{v}}">
%     elif kind == 'vehicle':
        <input type="text" name="{{key}}" value="{{v}}" maxlength="30" list="vehicles" placeholder="例如：{{example}}">
%     else:
        <input type="text" name="{{key}}" value="{{v}}" maxlength="300" class="{{cls}}" placeholder="{{'例如：' + example if example else ''}}">
%     end
        <small>{{hint}}</small>
      </label>
%   end
    </div>
  </section>
% end
  <datalist id="vehicles">
% for v in vehicles:
    <option value="{{v}}"></option>
% end
  </datalist>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存产品卡</button>
    <a class="btn" href="{{'/products/%d' % p['id'] if p is not None else '/products'}}">取消</a>
  </div>
</form>
