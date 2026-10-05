% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>{{fmt_md(today)}} 周{{weekday}}</h1>
    <p class="sub">每次沟通结束都写下次跟进时间；收工前把“今日待跟进”和“已逾期”清零。</p>
  </div>
  <div class="actions no-print">
    {{!include('_scope.tpl')}}
    <a class="btn btn-primary" href="/customers/new">＋ 登记客户</a>
  </div>
</div>

% for text, href, label in hints:
<div class="notice">{{text}} <a href="{{href}}">{{label}} →</a></div>
% end

<p class="tile-group">销售跟进</p>
<div class="tiles">
  <a class="tile {{'is-warn' if fc['today'] else ''}}" href="/customers?follow=today">
    <span class="tile-label">今日待跟进</span><span class="tile-value">{{fc['today']}}</span></a>
  <a class="tile {{'is-bad' if fc['overdue'] else ''}}" href="/customers?follow=overdue">
    <span class="tile-label">已逾期</span><span class="tile-value">{{fc['overdue']}}</span></a>
  <a class="tile {{'is-bad' if fc['unscheduled'] else ''}}" href="/customers?follow=none">
    <span class="tile-label">在跟但没排时间</span><span class="tile-value">{{fc['unscheduled']}}</span></a>
  <a class="tile" href="/calendar">
    <span class="tile-label">本周待跟进</span><span class="tile-value">{{fc['week']}}</span></a>
  <a class="tile" href="/customers?follow=active&amp;grade=A">
    <span class="tile-label">在跟的 A 类</span><span class="tile-value">{{fc['grade_a']}}</span></a>
</div>
<p class="tile-group">交付</p>
<div class="tiles">
  <a class="tile" href="/students">
    <span class="tile-label">交付中的学员</span><span class="tile-value">{{dc['active']}}</span></a>
  <a class="tile {{'is-bad' if dc['due'] else ''}}" href="/students?flag=due">
    <span class="tile-label">今日及逾期待办</span><span class="tile-value">{{dc['due']}}</span></a>
  <a class="tile {{'is-warn' if dc['exams7'] else ''}}" href="/students?flag=exam">
    <span class="tile-label">7 天内有考试</span><span class="tile-value">{{dc['exams7']}}</span></a>
  <a class="tile {{'is-bad' if dc['unscheduled'] else ''}}" href="/students?flag=none">
    <span class="tile-label">没排下次动作</span><span class="tile-value">{{dc['unscheduled']}}</span></a>
  <a class="tile {{'is-warn' if dc['docs_missing'] else ''}}" href="/students?flag=docs">
    <span class="tile-label">资料还没齐</span><span class="tile-value">{{dc['docs_missing']}}</span></a>
  <a class="tile {{'is-bad' if issues else ''}}" href="/issues">
    <span class="tile-label">没关闭的异常</span><span class="tile-value">{{issues}}</span></a>
</div>

<section class="card flush">
  <div class="card-head">
    <h2>今天要跟进的客户 <span class="muted">· {{len(due)}} 人</span></h2>
    <span class="muted">含逾期，A 类排最前</span>
  </div>
% if due:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>称呼</th><th>分级</th><th>应跟进</th><th>下一步动作</th><th class="col-opt">最近沟通要点</th><th class="col-opt2">状态</th><th class="col-opt">负责人</th><th></th></tr></thead>
    <tbody>
%   for c in due:
%     label, cls = due_info(c['next_follow_on'])
      <tr>
        <td class="r-main"><a class="name" href="/customers/{{c['id']}}">{{c['name']}}</a><br class="r-hide"><small class="lg-only">{{c['channel_name'] or ''}}</small></td>
        <td><span class="chip chip-{{c['grade'] or 'none'}}">{{c['grade'] or '未分级'}}</span></td>
        <td><span class="due {{cls}}">{{label}}</span></td>
        <td class="r-full"><span class="r-label">下一步：</span>{{c['next_action'] or '—'}}</td>
        <td class="col-opt cell-note r-full {{'' if c['notes'] else 'r-hide'}}">{{clip(c['notes'], 60)}}</td>
        <td class="col-opt2 r-meta">{{c['status']}}</td>
        <td class="col-opt r-meta"><span class="sm-only">{{c['channel_name'] or ''}} · </span>{{user_name(c['owner_id'])}}</td>
        <td class="tight r-act"><a class="btn btn-sm btn-primary" href="/customers/{{c['id']}}#follow">记录跟进</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty"><strong>现在没有到期的跟进</strong>客户写了“下次跟进时间”，到期当天会自动出现在这里。</div>
% end
</section>

% if unscheduled:
<section class="card flush">
  <div class="card-head">
    <h2>在跟但没排下次时间 <span class="muted">· {{fc['unscheduled']}} 人</span></h2>
    <span class="muted">没有时间点的跟进，最后会变成谁都以为别人会跟</span>
  </div>
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>称呼</th><th>分级</th><th>状态</th><th class="col-opt">登记日期</th><th class="col-opt">负责人</th><th></th></tr></thead>
    <tbody>
%   for c in unscheduled:
      <tr>
        <td class="r-main"><a class="name" href="/customers/{{c['id']}}">{{c['name']}}</a></td>
        <td><span class="chip chip-{{c['grade'] or 'none'}}">{{c['grade'] or '未分级'}}</span></td>
        <td class="r-meta">{{c['status']}}</td>
        <td class="col-opt r-meta"><span class="r-label">登记 </span>{{fmt_date(c['registered_on'])}}</td>
        <td class="col-opt r-meta">{{user_name(c['owner_id'])}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/customers/{{c['id']}}#follow">排时间</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
</section>
% end

<section class="card flush">
  <div class="card-head">
    <h2>交付提醒 <span class="muted">· {{len(reminders)}} 项</span></h2>
    <span class="muted">今天及逾期的待办，加未来 7 天的考试</span>
  </div>
% if reminders:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>学员</th><th>阶段</th><th>提示</th><th>下次动作</th><th class="col-opt">交付负责人</th><th></th></tr></thead>
    <tbody>
%   for r in reminders:
%     s = r['s']
      <tr>
        <td class="r-main"><a class="name" href="/students/{{s['id']}}">{{s['name']}}</a></td>
        <td class="nowrap"><span class="lg-only">{{s['stage']}}</span><span class="sm-only chip chip-blue">{{s['stage']}}</span></td>
        <td class="r-full">
%     for text, kind in r['hints']:
          <span class="chip {{'chip-red' if kind == 'over' else ('chip-amber' if kind == 'today' else 'chip-blue')}}">{{text}}</span>
%     end
        </td>
        <td class="r-full"><span class="r-label">下次动作：</span>{{s['next_action'] or '—'}}</td>
        <td class="col-opt r-meta"><span class="r-label">交付负责人 </span>{{user_name(s['owner_id'])}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/students/{{s['id']}}">打开</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty"><strong>现在没有到期的交付待办</strong>学员报名后会进到“学员交付”，这里按日期自动提醒。</div>
% end
</section>
