% rebase('base.tpl')
% val = lambda k: (f.raw(k) if posted else (s[k] if s is not None else ''))
<div class="page-head">
  <div>
    <h1>{{'修改话术' if s is not None else '新增话术'}}</h1>
    <p class="sub">每周复盘后只改一句。想让班型信息自动带入，就用这些占位符：【班型名称】【总费用】【已包含】【不包含】【收款主体】【报名主体】【付款凭证】【退款条件】。</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="{{'/scripts/%d/edit' % s['id'] if s is not None else '/scripts/new'}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <div class="form-grid">
      <label class="field"><span>分组</span>
        <select name="grp" required>
% for g in groups:
          <option value="{{g}}" {{'selected' if val('grp') == g else ''}}>{{g}}</option>
% end
        </select></label>
      <label class="field"><span>场景</span>
        <input type="text" name="scene" value="{{val('scene')}}" maxlength="40" required placeholder="例如：异议：别家更便宜"></label>
      <label class="field wide"><span>什么时候用</span>
        <input type="text" name="when_use" value="{{val('when_use')}}" maxlength="60"></label>
      <label class="field wide"><span>话术</span>
        <textarea name="body" rows="9" maxlength="4000" required>{{val('body')}}</textarea></label>
      <label class="field wide"><span>提醒与禁区</span>
        <textarea name="tips" rows="2" maxlength="600">{{val('tips')}}</textarea>
        <small>不承诺包过、免考、最低价、固定拿证天数。</small></label>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="/scripts">取消</a>
  </div>
</form>
% if s is not None:
<form method="post" action="/scripts/{{s['id']}}/delete" data-confirm="删除这条话术？">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <button type="submit" class="btn btn-danger btn-sm">删除这条话术</button>
</form>
% end
