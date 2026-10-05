% rebase('base.tpl')
% fv = lambda k: (f.get(k) if posted else (s[k] or ''))
% tv = lambda k: (f.raw(k) if posted else (s[k] or ''))
% checked = lambda key: (key in f.getlist('checks')) if posted else (key in done)
% active_now = s['stage'] not in consts.DONE_STAGES
<div class="page-head">
  <div>
    <h1>{{s['name']}} <span class="chip chip-blue">{{s['stage']}}</span></h1>
    <p class="sub">{{s['product_name'] or '班型未填'}} · {{fmt_date(s['enrolled_on'])}} 报名 · 交付负责人 {{user_name(s['owner_id']) or '未指定'}}
% if s['contact']:
      · {{s['contact']}}
% end
% if exam and active_now:
      · 最近考试 {{fmt_mdw(exam)}}（{{subject}}）
% end
    </p>
  </div>
  <div class="actions no-print">
    <a class="btn" href="/issues/new?student={{s['id']}}&amp;next=/students/{{s['id']}}">记一条异常</a>
    <a class="btn" href="/customers/{{s['customer_id']}}">客户资料</a>
  </div>
</div>

% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
% if s['k2_booking'] == '约不到' and not open_issue:
<div class="notice is-red">学员约不到车，还没有记异常。记下发生时间、联系了谁、预计什么时候解决。<a href="/issues/new?student={{s['id']}}&amp;next=/students/{{s['id']}}">去记一条 →</a></div>
% end

<form method="post" action="/students/{{s['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">

  <section class="card">
    <h2>进度</h2>
    <div class="form-grid">
      <label class="field"><span>当前阶段</span>
        <select name="stage">
% for st in consts.STAGES:
          <option value="{{st}}" {{'selected' if fv('stage') == st else ''}}>{{st}}</option>
% end
        </select>
        <small>考试结果填“通过”后会自动进到下一阶段，一般不用手动改。</small></label>
% if can_all:
      <label class="field"><span>交付负责人</span>
        <select name="owner_id">
%   for u in users:
          <option value="{{u['id']}}" {{'selected' if str(fv('owner_id')) == str(u['id']) else ''}}>{{u['display_name']}}{{'' if u['active'] else '（已停用）'}}</option>
%   end
        </select>
        <small>学员遇到事情找的就是这个人。</small></label>
% end
      <label class="field"><span>下次动作</span>
        <input type="text" name="next_action" value="{{fv('next_action')}}" maxlength="120" placeholder="例如：提醒科目一约考"></label>
      <div class="field"><label for="next_action_on" class="label">下次动作日期{{'＊' if active_now else ''}}</label>
        <input type="date" id="next_action_on" name="next_action_on" value="{{fv('next_action_on')}}">
        <div class="quick-dates">
          <button type="button" data-set-date="next_action_on" data-days="0">今天</button>
          <button type="button" data-set-date="next_action_on" data-days="1">明天</button>
          <button type="button" data-set-date="next_action_on" data-days="3">3 天后</button>
          <button type="button" data-set-date="next_action_on" data-days="7">一周后</button>
        </div></div>
    </div>
    <div class="form-actions"><button type="submit" class="btn btn-primary">保存</button></div>
  </section>

% for key, title, items in checklist:
%   n_done = sum(1 for it in items if checked(it[0]))
  <details class="stage-block {{'is-current' if key == current else ''}}" {{'open' if key == current or (key == 'enroll' and n_done < len(items)) or posted else ''}}>
    <summary><span>{{title}}</span><span class="count">{{n_done}} / {{len(items)}}</span></summary>
    <div class="stage-inner">
%   for ck, todo, result, trap in items:
      <label class="check">
        <input type="checkbox" name="checks" value="{{ck}}" {{'checked' if checked(ck) else ''}}>
        <span class="check-body"><strong>{{todo}}</strong>
          <small>做到：{{result}}　<span class="trap">坑：{{trap}}</span></small>
%     if ck in done:
          <small class="faint">{{fmt_dt(done[ck]['done_at'])}} {{user_name(done[ck]['done_by'])}} 完成</small>
%     end
        </span>
      </label>
%   end
%   if key == 'handover':
      <div class="stage-fields form-grid">
        <div class="field"><span class="label">资料是否齐全</span>
          <div class="radio-row">
            <label><input type="radio" name="docs_status" value="" {{'checked' if fv('docs_status') == '' else ''}}> 还没确认</label>
            <label><input type="radio" name="docs_status" value="齐全" {{'checked' if fv('docs_status') == '齐全' else ''}}> 齐全</label>
            <label><input type="radio" name="docs_status" value="缺资料" {{'checked' if fv('docs_status') == '缺资料' else ''}}> 缺资料</label>
          </div></div>
        <label class="field"><span>还缺什么</span>
          <input type="text" name="docs_missing" value="{{fv('docs_missing')}}" maxlength="120" placeholder="缺什么一次列清，例如：体检表、1 寸白底照片"></label>
      </div>
%   end
%   if key in ('k1', 'k2', 'k3', 'k4'):
      <div class="stage-fields form-grid">
%     if key == 'k2':
        <div class="field wide"><span class="label">约车情况</span>
          <div class="radio-row">
            <label><input type="radio" name="k2_booking" value="" {{'checked' if fv('k2_booking') == '' else ''}}> 还没确认</label>
            <label><input type="radio" name="k2_booking" value="正常" {{'checked' if fv('k2_booking') == '正常' else ''}}> 能正常约上</label>
            <label><input type="radio" name="k2_booking" value="约不到" {{'checked' if fv('k2_booking') == '约不到' else ''}}> 约不到</label>
          </div>
          <small>学员说约不到车，不能只回“我帮你问问”：<a href="/issues/new?student={{s['id']}}&amp;next=/students/{{s['id']}}">记进异常台账</a>，解决后再回访一次。</small></div>
%     end
        <label class="field"><span>考试日期</span>
          <input type="date" name="{{key}}_exam_on" value="{{fv(key + '_exam_on')}}"></label>
        <div class="field"><span class="label">考试结果</span>
          <div class="radio-row">
            <label><input type="radio" name="{{key}}_result" value="" {{'checked' if fv(key + '_result') == '' else ''}}> 还没考</label>
            <label><input type="radio" name="{{key}}_result" value="通过" {{'checked' if fv(key + '_result') == '通过' else ''}}> 通过</label>
            <label><input type="radio" name="{{key}}_result" value="未通过" {{'checked' if fv(key + '_result') == '未通过' else ''}}> 未通过</label>
          </div></div>
      </div>
%   end
%   if key == 'k4':
      <div class="stage-fields form-grid">
        <label class="field"><span>拿证日期</span>
          <input type="date" name="license_on" value="{{fv('license_on')}}" max="{{today}}"></label>
        <div class="field"><span class="label">愿意转介绍吗</span>
          <div class="radio-row">
%     for o, label in [('', '还没问'), ('愿意', '愿意'), ('待定', '待定'), ('不愿意', '不愿意')]:
            <label><input type="radio" name="refer_willing" value="{{o}}" {{'checked' if fv('refer_willing') == o else ''}}> {{label}}</label>
%     end
          </div></div>
        <label class="field"><span>回访：哪一步最顺</span>
          <textarea name="visit_smooth" rows="2" maxlength="600">{{tv('visit_smooth')}}</textarea></label>
        <label class="field"><span>回访：哪一步最麻烦</span>
          <textarea name="visit_hard" rows="2" maxlength="600">{{tv('visit_hard')}}</textarea></label>
        <label class="field wide"><span>回访：推荐给同学，最担心别人遇到什么</span>
          <textarea name="visit_worry" rows="2" maxlength="600">{{tv('visit_worry')}}</textarea>
          <small>填了拿证日期并勾上“回访三问”，这个学员会自动转为已完结。</small></label>
      </div>
%   end
    </div>
  </details>
% end

  <section class="card">
    <label class="field"><span>备注</span>
      <textarea name="remark" rows="2" maxlength="1000">{{tv('remark')}}</textarea></label>
    <div class="form-actions"><button type="submit" class="btn btn-primary">保存</button></div>
  </section>
</form>

<section class="card flush">
  <div class="card-head"><h2>这个学员的异常记录</h2><a class="btn btn-sm" href="/issues/new?student={{s['id']}}&amp;next=/students/{{s['id']}}">记一条</a></div>
% if issues:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>发生日期</th><th>问题</th><th>联系了谁</th><th>预计解决</th><th>状态</th><th></th></tr></thead>
    <tbody>
%   for i in issues:
      <tr class="{{'is-dim' if i['status'] == '已关闭' else ''}}">
        <td class="nowrap r-meta"><span class="r-label">发生 </span>{{fmt_date(i['occurred_on'])}}</td>
        <td class="r-full"><strong>{{i['kind']}}</strong> {{clip(i['description'], 50)}}</td>
        <td class="r-meta {{'' if i['contacted'] else 'r-hide'}}"><span class="r-label">联系了 </span>{{i['contacted']}}</td>
        <td class="nowrap r-meta {{'' if i['eta_on'] else 'r-hide'}}"><span class="r-label">预计解决 </span>{{fmt_date(i['eta_on'])}}</td>
        <td><span class="chip {{'chip-green' if i['status'] == '已关闭' else ('chip-amber' if i['status'] == '已解决待回访' else 'chip-red')}}">{{i['status']}}</span></td>
        <td class="tight r-act"><a class="btn btn-sm" href="/issues/{{i['id']}}/edit?next=/students/{{s['id']}}">更新</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty">没有异常记录。</div>
% end
</section>
