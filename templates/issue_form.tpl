% rebase('base.tpl')
% new = issue is None
% fv = lambda k, d='': (f.get(k) if posted else (str(issue[k]) if not new and issue[k] is not None else d))
% tv = lambda k: (f.raw(k) if posted else (issue[k] if not new else ''))
<div class="page-head">
  <div>
    <h1>{{'记一条异常' if new else '更新异常记录'}}</h1>
    <p class="sub">记下发生时间、联系了谁、预计什么时候解决。填了“实际解决日期”并勾上“已回访确认”，这条才算关闭。</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="{{'/issues/new' if new else '/issues/%d/edit' % issue['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <input type="hidden" name="next" value="{{next}}">
  <section class="card">
    <h2>发生了什么</h2>
    <div class="form-grid">
      <label class="field"><span>学员</span>
        <select name="student_id">
          <option value="">不关联学员</option>
% for st in students:
          <option value="{{st['id']}}" {{'selected' if fv('student_id', str(preset or '')) == str(st['id']) else ''}}>{{st['name']}}（{{st['stage']}}）</option>
% end
        </select></label>
      <label class="field"><span>发生日期＊</span>
        <input type="date" name="occurred_on" value="{{fv('occurred_on', today)}}" max="{{today}}" required></label>
      <label class="field"><span>所处阶段</span>
        <select name="stage">
          <option value="">未填</option>
% for st in consts.ISSUE_STAGES:
          <option value="{{st}}" {{'selected' if fv('stage') == st else ''}}>{{st}}</option>
% end
        </select></label>
      <label class="field"><span>问题类型</span>
        <input type="text" name="kind" value="{{fv('kind')}}" maxlength="20" list="kinds" placeholder="例如：约不到车">
        <datalist id="kinds">
% for k in consts.ISSUE_KINDS:
          <option value="{{k}}"></option>
% end
        </datalist></label>
      <label class="field wide"><span>问题描述＊</span>
        <textarea name="description" rows="3" maxlength="1000" required placeholder="例如：周末两天都约不上车">{{tv('description')}}</textarea></label>
    </div>
  </section>
  <section class="card">
    <h2>怎么处理</h2>
    <div class="form-grid">
      <label class="field"><span>联系了谁</span>
        <input type="text" name="contacted" value="{{fv('contacted')}}" maxlength="80" placeholder="例如：张教练、驾校排班负责人"></label>
      <div class="field"><label for="eta_on" class="label">预计解决时间</label>
        <input type="date" id="eta_on" name="eta_on" value="{{fv('eta_on')}}">
        <div class="quick-dates">
          <button type="button" data-set-date="eta_on" data-days="0">今天</button>
          <button type="button" data-set-date="eta_on" data-days="1">明天</button>
          <button type="button" data-set-date="eta_on" data-days="3">3 天后</button>
        </div>
        <small>给学员一个明确的答复时间。</small></div>
      <label class="field"><span>实际解决日期</span>
        <input type="date" name="solved_on" value="{{fv('solved_on')}}" max="{{today}}"></label>
% if can_all:
      <label class="field"><span>负责人</span>
        <select name="owner_id">
%   for u in users:
          <option value="{{u['id']}}" {{'selected' if fv('owner_id', str(user['id'])) == str(u['id']) else ''}}>{{u['display_name']}}{{'' if u['active'] else '（已停用）'}}</option>
%   end
        </select></label>
% end
      <label class="check wide"><input type="checkbox" name="revisit_ok" value="1" {{'checked' if fv('revisit_ok', '0') == '1' else ''}}>
        <span class="check-body"><strong>解决后已回访确认</strong><small>确认学员那边真的没问题了，比如真的练上车了，而不是聊天框里看起来已经回复了。</small></span></label>
      <label class="field wide"><span>备注</span>
        <textarea name="remark" rows="2" maxlength="1000">{{tv('remark')}}</textarea></label>
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="{{next or '/issues'}}">取消</a>
  </div>
</form>
% if not new and admin:
<form method="post" action="/issues/{{issue['id']}}/delete" data-confirm="删除这条异常记录？">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <button type="submit" class="btn btn-danger btn-sm">删除这条记录</button>
</form>
% end
