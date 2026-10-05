% rebase('base.tpl')
% new = t is None
% fv = lambda k, d='': (f.get(k) if posted else (str(t[k]) if not new and t[k] is not None else d))
<div class="page-head">
  <div>
    <h1>{{'新增选题' if new else '更新选题'}}</h1>
    <p class="sub">内容解决的是学员报名之前的担心。发布以后把曝光和带来的加微数填回来，复盘时才知道哪类内容有用。</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="{{'/topics/new' if new else '/topics/%d/edit' % t['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <div class="form-grid">
      <label class="field wide"><span>选题＊</span>
        <input type="text" name="title" value="{{fv('title')}}" maxlength="60" required placeholder="例如：合同里的费用怎么核对"></label>
      <label class="field wide"><span>解决哪个担心 / 内容要点</span>
        <input type="text" name="worry" value="{{fv('worry')}}" maxlength="120"></label>
      <label class="field"><span>形式</span>
        <input type="text" name="form" value="{{fv('form')}}" maxlength="20" list="forms">
        <datalist id="forms">
% for k in consts.TOPIC_FORMS:
          <option value="{{k}}"></option>
% end
        </datalist></label>
      <label class="field"><span>计划发布日</span>
        <input type="date" name="plan_on" value="{{fv('plan_on')}}"></label>
      <label class="field"><span>状态</span>
        <select name="status">
% for k in consts.TOPIC_STATUS:
          <option value="{{k}}" {{'selected' if fv('status', '待拍') == k else ''}}>{{k}}</option>
% end
        </select></label>
      <label class="field"><span>曝光</span>
        <input type="number" name="exposure" value="{{fv('exposure')}}" min="0" step="1" inputmode="numeric"></label>
      <label class="field"><span>带来加微</span>
        <input type="number" name="wechat_adds" value="{{fv('wechat_adds')}}" min="0" step="1" inputmode="numeric"></label>
      <label class="field wide"><span>备注 / 复盘</span>
        <textarea name="note" rows="2" maxlength="600">{{f.raw('note') if posted else ('' if new else t['note'])}}</textarea></label>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="/channels#topics">取消</a>
  </div>
</form>
% if not new:
<form method="post" action="/topics/{{t['id']}}/delete" data-confirm="删除这个选题？">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <button type="submit" class="btn btn-danger btn-sm">删除这个选题</button>
</form>
% end
