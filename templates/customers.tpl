% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>客户 <span class="muted num">· {{pg['total']}}</span></h1>
    <p class="sub">分级看行为，不看第一印象：A 今天推进 · B 发对比清单并约时间 · C 低频内容触达 · D 留记录不打扰。</p>
  </div>
  <div class="actions"><a class="btn btn-primary" href="/customers/new">＋ 登记客户</a></div>
</div>

<form method="get" action="/customers" class="filters no-print">
  <label class="field grow"><span>搜索</span>
    <input type="search" name="q" value="{{q.get('q')}}" placeholder="称呼、联系方式、学校、沟通要点"></label>
  <label class="field"><span>跟进</span>
    <select name="follow" data-autosubmit>
% for v, label in [('', '全部'), ('active', '在跟的'), ('today', '今天要跟进'), ('overdue', '已逾期'), ('none', '没排时间'), ('closed', '已结束')]:
      <option value="{{v}}" {{'selected' if q.get('follow') == v else ''}}>{{label}}</option>
% end
    </select></label>
  <label class="field"><span>分级</span>
    <select name="grade" data-autosubmit>
      <option value="">全部</option>
% for g in grades:
      <option value="{{g}}" {{'selected' if q.get('grade') == g else ''}}>{{g}} 类</option>
% end
      <option value="none" {{'selected' if q.get('grade') == 'none' else ''}}>未分级</option>
    </select></label>
  <label class="field"><span>状态</span>
    <select name="status" data-autosubmit>
      <option value="">全部</option>
% for s in statuses:
      <option value="{{s}}" {{'selected' if q.get('status') == s else ''}}>{{s}}</option>
% end
    </select></label>
  <label class="field"><span>来源渠道</span>
    <select name="channel" data-autosubmit>
      <option value="">全部</option>
% for ch in channels:
      <option value="{{ch['id']}}" {{'selected' if q.get('channel') == str(ch['id']) else ''}}>{{ch['name']}}{{'（已停用）' if ch['archived'] else ''}}</option>
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
    <thead><tr><th>称呼</th><th>分级</th><th>状态</th><th>下次跟进</th><th>下一步动作</th><th class="col-opt">最近沟通</th><th class="col-opt">渠道</th><th class="col-opt">负责人</th></tr></thead>
    <tbody>
%   for c in items:
%     label, cls = due_info(c['next_follow_on'])
      <tr class="{{'' if c['is_active'] else 'is-dim'}}">
        <td class="r-main"><a class="name" href="/customers/{{c['id']}}">{{c['name']}}</a>
%     if c['school']:
          <br class="r-hide"><small>{{c['school']}}</small>
%     end
        </td>
        <td><span class="chip chip-{{c['grade'] or 'none'}}">{{c['grade'] or '未分级'}}</span></td>
        <td class="nowrap"><span class="{{'chip chip-green' if c['status'] in ('已正式报名', '已交定金') else ''}}">{{c['status']}}</span></td>
        <td class="{{'' if c['is_active'] else 'r-hide'}}">
%     if c['is_active']:
          <span class="due {{cls}}">{{label}}</span>
%     else:
          <span class="faint">—</span>
%     end
        </td>
        <td class="r-full {{'' if c['is_active'] and c['next_action'] else 'r-hide'}}"><span class="r-label">下一步：</span>{{c['next_action'] if c['is_active'] else ''}}</td>
        <td class="col-opt cell-note r-full {{'' if c['last_contact_on'] else 'r-hide'}}">
%     if c['last_contact_on']:
          <span class="nowrap">{{fmt_date(c['last_contact_on'])}}</span> {{clip(c['notes'], 40)}}
%     end
        </td>
        <td class="col-opt r-meta">{{c['channel_name'] or ''}}</td>
        <td class="col-opt r-meta">{{user_name(c['owner_id'])}}</td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
  {{!include('_pager.tpl')}}
% else:
  <div class="empty"><strong>没有符合条件的客户</strong>换个筛选条件，或者<a href="/customers/new">登记一个新客户</a>。</div>
% end
</section>
