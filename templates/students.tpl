% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>学员交付 <span class="muted num">· {{len(items)}}</span></h1>
    <p class="sub">客户一报名就进到这里，按节点交付。每个学员都要有交付负责人、当前阶段和下次动作日期。</p>
  </div>
  <div class="actions"><a class="btn" href="/issues/new">记一条异常</a></div>
</div>

<form method="get" action="/students" class="filters no-print">
  <label class="field grow"><span>搜索</span>
    <input type="search" name="q" value="{{q.get('q')}}" placeholder="学员称呼、联系方式"></label>
  <label class="field"><span>阶段</span>
    <select name="stage" data-autosubmit>
      <option value="">交付中的</option>
% for st in stages:
      <option value="{{st}}" {{'selected' if q.get('stage') == st else ''}}>{{st}}</option>
% end
      <option value="all" {{'selected' if q.get('stage') == 'all' else ''}}>全部（含已完结）</option>
    </select></label>
  <label class="field"><span>提醒</span>
    <select name="flag" data-autosubmit>
% for v, label in [('', '不限'), ('due', '待办到期'), ('exam', '7 天内有考试'), ('none', '没排下次动作'), ('docs', '资料没齐'), ('booking', '约不到车')]:
      <option value="{{v}}" {{'selected' if q.get('flag') == v else ''}}>{{label}}</option>
% end
    </select></label>
% if can_all:
  <label class="field"><span>负责人</span>
    <select name="owner" data-autosubmit>
      <option value="">全部成员</option>
%   for u in users:
      <option value="{{u['id']}}" {{'selected' if owner == str(u['id']) else ''}}>{{u['display_name']}}{{'（我）' if u['id'] == user['id'] else ''}}</option>
%   end
    </select></label>
% end
  <button type="submit" class="btn">筛选</button>
</form>

<section class="card flush">
% if items:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>学员</th><th>阶段</th><th>下次动作</th><th>提醒</th><th class="col-opt">班型</th><th class="col-opt">交付负责人</th></tr></thead>
    <tbody>
%   for it in items:
%     s = it['s']
%     label, cls = due_info(s['next_action_on'])
      <tr class="{{'' if it['active'] else 'is-dim'}}">
        <td class="r-main"><a class="name" href="/students/{{s['id']}}">{{s['name']}}</a><br class="r-hide"><small>{{fmt_date(s['enrolled_on'])}} 报名</small></td>
        <td><span class="chip {{'chip-blue' if it['active'] else ''}}">{{s['stage']}}</span></td>
        <td class="r-full {{'' if it['active'] else 'r-hide'}}">
%     if it['active']:
          <span class="r-label">下次动作：</span><span class="due {{cls}}">{{label}}</span><br class="r-hide"> <span class="cell-note">{{s['next_action']}}</span>
%     else:
          <span class="faint">—</span>
%     end
        </td>
        <td class="r-full">
%     if it['active'] and it['exam']:
          <span class="chip {{'chip-amber' if it['exam_soon'] else ''}}">{{fmt_md(it['exam'])}} 考{{it['subject']}}</span>
%     end
%     if s['docs_status'] == '缺资料':
          <span class="chip chip-red">缺资料{{'：' + s['docs_missing'] if s['docs_missing'] else ''}}</span>
%     end
%     if s['k2_booking'] == '约不到':
          <span class="chip chip-red">约不到车</span>
%     end
%     if s['open_issues']:
          <a class="chip chip-red" href="/issues">异常 {{s['open_issues']}}</a>
%     end
        </td>
        <td class="col-opt r-meta">{{s['product_name'] or ''}}</td>
        <td class="col-opt r-meta"><span class="r-label">交付负责人 </span>{{user_name(s['owner_id'])}}</td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty"><strong>没有符合条件的学员</strong>客户在“四项核对与报名”里办完正式报名，会自动出现在这里。</div>
% end
</section>
