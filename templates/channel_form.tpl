% rebase('base.tpl')
% new = ch is None
% fv = lambda k, d='': (f.get(k) if posted else (ch[k] if not new and ch[k] is not None else d))
<div class="page-head">
  <div>
    <h1>{{'新增渠道' if new else '修改渠道'}}</h1>
    <p class="sub">已经登记过客户的渠道尽量不要改名，免得大家对不上。</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="{{'/channels/new' if new else '/channels/%d/edit' % ch['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <div class="form-grid">
      <label class="field"><span>渠道名称＊</span>
        <input type="text" name="name" value="{{fv('name')}}" maxlength="20" required></label>
      <label class="field"><span>渠道码</span>
        <input type="text" name="code" value="{{fv('code')}}" maxlength="8" placeholder="例如：BD">
        <small>写在微信备注里，例如 BD-小李-1005。</small></label>
      <label class="field"><span>类型</span>
        <select name="kind">
% for k in consts.CHANNEL_KINDS:
          <option value="{{k}}" {{'selected' if fv('kind') == k else ''}}>{{k}}</option>
% end
        </select></label>
      <label class="field"><span>状态</span>
        <select name="status">
% for k in consts.CHANNEL_STATUS:
          <option value="{{k}}" {{'selected' if fv('status', '筹备中') == k else ''}}>{{k}}</option>
% end
        </select></label>
      <label class="field"><span>负责人</span>
        <input type="text" name="owner" value="{{fv('owner')}}" maxlength="20"></label>
      <label class="field"><span>启用日期</span>
        <input type="date" name="start_on" value="{{fv('start_on')}}"></label>
      <label class="field wide"><span>怎么做</span>
        <textarea name="how" rows="3" maxlength="600">{{f.raw('how') if posted else ('' if new else ch['how'])}}</textarea></label>
      <label class="field wide"><span>备注</span>
        <textarea name="note" rows="2" maxlength="600">{{f.raw('note') if posted else ('' if new else ch['note'])}}</textarea></label>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="/channels">取消</a>
  </div>
</form>
