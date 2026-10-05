% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>异常台账 <span class="muted num">· {{open_count}} 条没关闭</span></h1>
    <p class="sub">学员反馈问题，不能只回“我帮你问问”。记下发生时间、联系了谁、预计什么时候解决；解决以后再回访一次，确认真的解决了，才算关闭。</p>
  </div>
  <div class="actions no-print">
    <span class="seg">
      <a href="/issues" class="{{'' if show == 'all' else 'on'}}">没关闭的</a>
      <a href="/issues?show=all" class="{{'on' if show == 'all' else ''}}">全部</a>
    </span>
    <a class="btn btn-primary" href="/issues/new">＋ 记一条异常</a>
  </div>
</div>

<section class="card flush">
% if items:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>发生日期</th><th>学员</th><th>问题</th><th class="col-opt">联系了谁</th><th>预计解决</th><th>状态</th><th class="col-opt">负责人</th><th></th></tr></thead>
    <tbody>
%   for i in items:
%     late = i['status'] == '处理中' and i['eta_on'] and i['eta_on'] < today
      <tr class="{{'is-dim' if i['status'] == '已关闭' else ''}}">
        <td class="nowrap r-meta"><span class="r-label">发生 </span>{{fmt_date(i['occurred_on'])}}</td>
        <td class="r-main">
%     if i['student_id']:
          <a class="name" href="/students/{{i['student_id']}}">{{i['student_name']}}</a>
%     else:
          <span class="muted">未关联学员</span>
%     end
          <br class="r-hide"><small>{{i['stage']}}</small></td>
        <td class="r-full"><strong>{{i['kind']}}</strong> {{clip(i['description'], 60)}}</td>
        <td class="col-opt r-meta {{'' if i['contacted'] else 'r-hide'}}"><span class="r-label">联系了 </span>{{i['contacted']}}</td>
        <td class="nowrap r-meta"><span class="r-label">预计解决 </span><span class="{{'due due-over' if late else ''}}">{{fmt_date(i['eta_on']) or '—'}}{{'（已过）' if late else ''}}</span></td>
        <td><span class="chip {{'chip-green' if i['status'] == '已关闭' else ('chip-amber' if i['status'] == '已解决待回访' else 'chip-red')}}">{{i['status']}}</span></td>
        <td class="col-opt r-meta">{{user_name(i['owner_id'])}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/issues/{{i['id']}}/edit">更新</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty"><strong>{{'还没有异常记录' if show == 'all' else '没有未关闭的异常'}}</strong>学员说约不到车、对费用有疑问、要投诉，都记在这里。</div>
% end
</section>
