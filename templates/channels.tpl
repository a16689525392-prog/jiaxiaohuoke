% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>获客渠道</h1>
    <p class="sub">每个渠道一个标记，记录客户从哪里来，后面才知道是短视频有效，还是摆点有效。内容解决报名前的担心，私聊再做具体匹配。</p>
  </div>
  <div class="actions">
% if admin:
    <a class="btn btn-primary" href="/channels/new">＋ 新增渠道</a>
% end
  </div>
</div>

<section class="card">
  <h2>统一入口</h2>
  <p class="card-note">所有渠道都用同一个企业微信或指定的工作微信。不要今天让客户加这个人，明天又让客户找另一个人。</p>
% if admin:
  <form method="post" action="/channels/entry" class="filters">
    <input type="hidden" name="_csrf" value="{{csrf}}">
    <label class="field grow"><span>企业微信 / 工作微信号</span>
      <input type="text" name="unified_entry" value="{{entry}}" maxlength="80" placeholder="例如：企业微信“××驾校报名咨询”"></label>
    <button type="submit" class="btn btn-primary">保存</button>
  </form>
% else:
  <p><strong>{{entry or '管理员还没填'}}</strong></p>
% end
  <p class="muted">微信备注格式：渠道码-称呼-日期，例如 BD-小李-1005。加上微信后当场写好。</p>
</section>

<section class="card flush">
  <div class="card-head"><h2>渠道</h2><span class="muted">累计数字来自客户登记</span></div>
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>渠道</th><th>渠道码</th><th class="col-opt2">类型</th><th>怎么做</th><th>状态</th><th class="right">累计加微</th><th class="right">累计报名</th>
% if admin:
      <th></th>
% end
    </tr></thead>
    <tbody>
% for ch in items:
%   n, e = totals.get(ch['id'], (0, 0))
      <tr>
        <td class="nowrap r-main"><strong>{{ch['name']}}</strong>
%   if ch['owner']:
          <br class="r-hide"><small>{{ch['owner']}}</small>
%   end
        </td>
        <td><code>{{ch['code']}}</code></td>
        <td class="col-opt2 r-hide">{{ch['kind']}}</td>
        <td class="cell-note r-full">{{ch['how']}}
%   if ch['note']:
          <br><span class="faint">{{ch['note']}}</span>
%   end
        </td>
        <td><span class="chip {{'chip-green' if ch['status'] == '进行中' else ''}}">{{ch['status']}}</span></td>
        <td class="right num r-meta"><span class="r-label">累计加微 </span><a href="/customers?channel={{ch['id']}}&amp;owner=">{{n}}</a></td>
        <td class="right num r-meta"><span class="r-label">累计报名 </span>{{e}}</td>
%   if admin:
        <td class="tight r-act">
          <a class="btn btn-sm" href="/channels/{{ch['id']}}/edit">修改</a>
          <form method="post" action="/channels/{{ch['id']}}/archive" class="inline-form" data-confirm="{{'恢复这个渠道？' if ch['archived'] else '停用这个渠道？已登记的客户不受影响。'}}">
            <input type="hidden" name="_csrf" value="{{csrf}}">
            <button type="submit" class="btn btn-sm">{{'恢复' if ch['archived'] else '停用'}}</button>
          </form>
        </td>
%   end
      </tr>
% end
    </tbody>
  </table>
  </div>
</section>
% if show_archived:
<p><a href="/channels">← 回到在用的渠道</a></p>
% elif archived_count:
<p><a class="muted" href="/channels?archived=1">查看已停用的渠道（{{archived_count}}）</a></p>
% end

<section class="card flush" id="topics">
  <div class="card-head"><h2>内容选题</h2><a class="btn btn-sm btn-primary" href="/topics/new">＋ 新增选题</a></div>
  <p class="card-note">不要只拍一张价格海报。拍学员报名之前的担心：什么时候适合报名、第一次去驾校带什么、合同里的费用怎么核对。</p>
% if topics:
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>选题</th><th>解决哪个担心</th><th class="col-opt">形式</th><th>计划发布</th><th>状态</th><th class="right col-opt">曝光</th><th class="right col-opt">带来加微</th><th></th></tr></thead>
    <tbody>
%   for t in topics:
      <tr class="{{'is-dim' if t['status'] == '已复盘' else ''}}">
        <td class="r-main"><strong>{{t['title']}}</strong></td>
        <td class="cell-note r-full {{'' if t['worry'] else 'r-hide'}}">{{t['worry']}}</td>
        <td class="col-opt r-meta {{'' if t['form'] else 'r-hide'}}">{{t['form']}}</td>
        <td class="nowrap r-meta {{'' if t['plan_on'] else 'r-hide'}}"><span class="r-label">计划 </span>{{fmt_date(t['plan_on']) or '—'}}</td>
        <td><span class="chip {{'chip-green' if t['status'] == '已发布' else ''}}">{{t['status']}}</span></td>
        <td class="right num col-opt r-meta {{'r-hide' if t['exposure'] is None else ''}}"><span class="r-label">曝光 </span>{{'' if t['exposure'] is None else money(t['exposure'])}}</td>
        <td class="right num col-opt r-meta {{'r-hide' if t['wechat_adds'] is None else ''}}"><span class="r-label">加微 </span>{{'' if t['wechat_adds'] is None else t['wechat_adds']}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/topics/{{t['id']}}/edit">更新</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty">还没有选题。</div>
% end
</section>
