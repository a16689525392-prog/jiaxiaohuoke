% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>跟进日历</h1>
    <p class="sub">蓝色是当天要跟进的客户，红色是已经过期还没清零的，绿色是交付待办和考试。点某一天看名单。</p>
  </div>
  <div class="actions no-print">
    {{!include('_scope.tpl')}}
    <span class="seg">
      <a href="{{req.url(w=offset - 1, d=None)}}">← 上一周</a>
      <a href="{{req.url(w=None, d=None)}}" class="{{'on' if offset == 0 else ''}}">本周</a>
      <a href="{{req.url(w=offset + 1, d=None)}}">下一周 →</a>
    </span>
  </div>
</div>

<div class="tiles">
  <div class="tile {{'is-warn' if fc['today'] else ''}}"><span class="tile-label">今日待跟进</span><span class="tile-value">{{fc['today']}}</span></div>
  <div class="tile {{'is-bad' if fc['overdue'] else ''}}"><span class="tile-label">已逾期</span><span class="tile-value">{{fc['overdue']}}</span></div>
  <div class="tile {{'is-bad' if fc['unscheduled'] else ''}}"><span class="tile-label">在跟但没排时间</span><span class="tile-value">{{fc['unscheduled']}}</span></div>
  <div class="tile"><span class="tile-label">本周待跟进</span><span class="tile-value">{{fc['week']}}</span></div>
  <div class="tile {{'is-bad' if dc['due'] else ''}}"><span class="tile-label">交付待办到期</span><span class="tile-value">{{dc['due']}}</span></div>
  <div class="tile {{'is-warn' if dc['exams7'] else ''}}"><span class="tile-label">7 天内有考试</span><span class="tile-value">{{dc['exams7']}}</span></div>
</div>

<section class="card flush">
  <div class="cal">
% for name in ['周一', '周二', '周三', '周四', '周五', '周六', '周日']:
    <div class="cal-head">{{name}}</div>
% end
% for week in weeks:
%   for day, n in week:
%     cls = 'is-today' if day == today else ('is-past' if day < today else '')
    <a class="cal-day {{cls}} {{'is-picked' if day == picked and day != today else ''}}" href="{{req.url(d=day)}}#day">
      <span class="cal-date"><span class="lg-only">{{fmt_md(day)}}</span><span class="sm-only">{{'%d/%d' % (int(day[5:7]), int(day[8:])) if day[8:] == '01' or day == first else int(day[8:])}}</span></span>
%     if n['total']:
      <span class="cal-tag {{'cal-late' if day < today else 'cal-sales'}}" title="A {{n['A']}} · B {{n['B']}} · C {{n['C']}}"><span class="lg-only">跟进 {{n['total']}}{{'（A ' + str(n['A']) + '）' if n['A'] else ''}}</span><span class="sm-only">跟{{n['total']}}</span></span>
%     end
%     if n['todo']:
      <span class="cal-tag cal-deliv"><span class="lg-only">交付 {{n['todo']}}</span><span class="sm-only">交{{n['todo']}}</span></span>
%     end
%     if n['exam']:
      <span class="cal-tag cal-deliv"><span class="lg-only">考试 {{n['exam']}}</span><span class="sm-only">考{{n['exam']}}</span></span>
%     end
    </a>
%   end
% end
  </div>
</section>

<section class="card flush" id="day">
  <div class="card-head">
    <h2>{{fmt_mdw(picked)}}{{'（今天）' if picked == today else ''}}</h2>
    <span class="muted">要跟进的客户 {{len(customers)}} 人 · 交付事项 {{len(students)}} 项</span>
  </div>
% if customers:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>客户</th><th>分级</th><th>状态</th><th>下一步动作</th><th class="col-opt">负责人</th><th></th></tr></thead>
    <tbody>
%   for c in customers:
      <tr>
        <td class="r-main"><a class="name" href="/customers/{{c['id']}}">{{c['name']}}</a></td>
        <td><span class="chip chip-{{c['grade'] or 'none'}}">{{c['grade'] or '未分级'}}</span></td>
        <td class="r-meta">{{c['status']}}</td>
        <td class="r-full"><span class="r-label">下一步：</span>{{c['next_action'] or '—'}}</td>
        <td class="col-opt r-meta">{{user_name(c['owner_id'])}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/customers/{{c['id']}}#follow">记录跟进</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% end
% if students:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>学员</th><th>阶段</th><th>当天事项</th><th>下次动作</th><th class="col-opt">交付负责人</th><th></th></tr></thead>
    <tbody>
%   for r in students:
%     s = r['s']
      <tr>
        <td class="r-main"><a class="name" href="/students/{{s['id']}}">{{s['name']}}</a></td>
        <td class="r-meta">{{s['stage']}}</td>
        <td>
%     for w in r['what']:
          <span class="chip chip-green">{{w}}</span>
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
% end
% if not customers and not students:
  <div class="empty">这一天没有安排。</div>
% end
</section>
