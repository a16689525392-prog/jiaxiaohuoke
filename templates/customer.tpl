% rebase('base.tpl')
% enrolled = c['status'] == '已正式报名'
% locked = c['status'] in ('已正式报名', '已交定金')
% posted = bool(errors)
% fv = lambda k, d: (f.get(k) if posted else d)
<div class="page-head">
  <div>
    <h1>{{c['name']}}
      <span class="chip chip-{{c['grade'] or 'none'}}">{{c['grade'] + ' 类' if c['grade'] else '未分级'}}</span>
      <span class="chip {{'chip-green' if locked else ''}}">{{c['status']}}</span>
    </h1>
    <p class="sub">{{c['channel_name'] or '渠道未填'}} · 负责人 {{user_name(c['owner_id']) or '未指定'}} · {{fmt_date(c['registered_on'])}} 登记
% if active_now:
%   label, cls = due_info(c['next_follow_on'])
      · 下次跟进 <span class="due {{cls}}">{{label}}</span>
% end
    </p>
  </div>
  <div class="actions no-print">
% if student:
    <a class="btn btn-primary" href="/students/{{student['id']}}">打开学员交付</a>
% else:
    <a class="btn btn-amber" href="/customers/{{c['id']}}/enroll">{{'办理正式报名' if c['status'] == '已交定金' else '四项核对与报名'}}</a>
% end
    <a class="btn" href="/customers/{{c['id']}}/edit">编辑资料</a>
  </div>
</div>

% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end

<div class="split">
  <div>
    <section class="card" id="follow">
      <h2>记录跟进</h2>
% if enrolled:
      <p class="card-note">已正式报名，后面的事在“学员交付”里按节点跟。这里仍然可以补记沟通内容。</p>
% end
      <form method="post" action="/customers/{{c['id']}}/follow" class="stack">
        <input type="hidden" name="_csrf" value="{{csrf}}">
        <input type="hidden" name="next" value="/customers/{{c['id']}}">
        <label class="field"><span>这次沟通的要点 / 客户顾虑</span>
          <textarea name="summary" rows="3" maxlength="2000" placeholder="客户当时担心什么，你说了什么，对方卡在哪一步">{{f.raw('summary') if posted else ''}}</textarea></label>
% if not enrolled:
        <div class="field"><span class="label">分级</span>
          <div class="radio-row">
            <label><input type="radio" name="grade" value="" {{'checked' if fv('grade', c['grade']) == '' else ''}}> 未分级</label>
%   for g in consts.GRADES:
            <label title="{{consts.GRADE_HELP[g]}}"><input type="radio" name="grade" value="{{g}}" {{'checked' if fv('grade', c['grade']) == g else ''}}> {{g}}</label>
%   end
          </div>
          <details><summary class="muted">分级标准</summary>
            <ul class="help-list">
%   for g in consts.GRADES:
              <li><strong>{{g}}</strong>：{{consts.GRADE_HELP[g]}}</li>
%   end
            </ul>
          </details>
        </div>
        <div class="form-grid">
          <label class="field"><span>当前状态</span>
%   if c['status'] == '已交定金':
            <select name="status">
              <option value="已交定金" selected>已交定金</option>
              <option value="暂不跟进" {{'selected' if fv('status', '') == '暂不跟进' else ''}}>暂不跟进（定金已处理）</option>
            </select>
            <small>正式报名请走右上角的“办理正式报名”。</small>
%   else:
            <select name="status">
%     for s in consts.OPEN_STATUSES + ['暂不跟进']:
              <option value="{{s}}" {{'selected' if fv('status', c['status']) == s else ''}}>{{s}}</option>
%     end
            </select>
            <small>收定金或正式报名，走右上角的“四项核对与报名”。</small>
%   end
          </label>
          <label class="field"><span>沟通日期</span>
            <input type="date" name="contact_on" value="{{fv('contact_on', today)}}" max="{{today}}"></label>
          <label class="field wide"><span>下一步动作</span>
            <input type="text" name="next_action" value="{{fv('next_action', c['next_action'])}}" maxlength="120" placeholder="例如：把合同里的退费条款发给他，约周六看场地"></label>
          <div class="field wide"><label for="next_follow_on" class="label">下次跟进时间</label>
            <input type="date" id="next_follow_on" name="next_follow_on" value="{{fv('next_follow_on', c['next_follow_on'] if c['next_follow_on'] and c['next_follow_on'] >= today else '')}}" min="{{today}}">
            <div class="quick-dates">
              <button type="button" data-set-date="next_follow_on" data-days="0">今天</button>
              <button type="button" data-set-date="next_follow_on" data-days="1">明天</button>
              <button type="button" data-set-date="next_follow_on" data-days="2">后天</button>
              <button type="button" data-set-date="next_follow_on" data-days="3">3 天后</button>
              <button type="button" data-set-date="next_follow_on" data-days="mon">下周一</button>
              <button type="button" data-set-date="next_follow_on" data-days="7">一周后</button>
            </div>
            <small>每次沟通结束都要写。D 类和“暂不跟进”可以不填。</small></div>
        </div>
% end
        <div class="form-actions"><button type="submit" class="btn btn-primary">保存这次跟进</button></div>
      </form>
    </section>

    <section class="card">
      <h2>跟进记录 <span class="muted">· {{len(log)}} 条</span></h2>
      <ul class="timeline">
% for e in log:
        <li class="{{'' if e['kind'] == 'note' else 'is-system'}}">
          <div class="when">{{fmt_dt(e['at'])}} · {{user_name(e['user_id']) or '系统'}}
%   if e['grade']:
            <span class="chip chip-{{e['grade']}}">{{e['grade']}}</span>
%   end
            <span class="chip">{{e['status']}}</span>
          </div>
          <div class="what">{{nl2br(e['summary'])}}</div>
%   if e['next_action'] or e['next_follow_on']:
          <div class="next">下一步：{{e['next_action'] or '—'}}{{'；' + fmt_mdw(e['next_follow_on']) + ' 跟进' if e['next_follow_on'] else ''}}</div>
%   end
        </li>
% end
      </ul>
    </section>
  </div>

  <div>
    <section class="card">
      <div class="card-head"><h2>资料</h2><a href="/customers/{{c['id']}}/edit">编辑</a></div>
      <dl class="kv">
        <dt>联系方式</dt><dd>{{c['contact'] or '—'}}</dd>
        <dt>学校 / 区域</dt><dd>{{c['school'] or '—'}}</dd>
        <dt>想学车型</dt><dd>{{c['vehicle'] or '—'}}</dd>
        <dt>计划报名</dt><dd>{{c['plan'] or '—'}}</dd>
        <dt>可练车时间</dt><dd>{{c['slots'] or '—'}}</dd>
        <dt>预算范围</dt><dd>{{c['budget'] or '—'}}</dd>
        <dt>最关心</dt><dd>{{c['concern'] or '—'}}</dd>
% if c['remark']:
        <dt>备注</dt><dd>{{nl2br(c['remark'])}}</dd>
% end
      </dl>
    </section>

    <section class="card">
      <div class="card-head"><h2>匹配班型</h2>
% if product:
        <a href="/products/{{product['id']}}">对客产品卡</a>
% end
      </div>
% if product:
      <dl class="kv">
        <dt>班型</dt><dd><strong>{{product['name'] or '未命名班型'}}</strong> {{product['vehicle']}}</dd>
        <dt>总费用</dt><dd class="{{'pending' if is_pending(product['fee']) else ''}}">{{(money(product['fee']) + ' 元') if is_number(product['fee']) else (product['fee'] or PENDING)}}</dd>
        <dt>已包含</dt><dd class="{{'pending' if is_pending(product['incl']) else ''}}">{{product['incl'] or PENDING}}</dd>
        <dt>不包含</dt><dd class="{{'pending' if is_pending(product['excl']) else ''}}">{{product['excl'] or PENDING}}</dd>
      </dl>
%   if quote:
      <details>
        <summary class="muted">报价话术（已带入这个班型）</summary>
        <div class="script-body" id="quote-text">{{quote}}</div>
        <button type="button" class="btn btn-sm" data-copy="quote-text">复制话术</button>
      </details>
%   end
% else:
      <p class="muted">还没匹配班型。需求问清楚以后，在“编辑资料”里选一个。</p>
% end
    </section>

    <section class="card">
      <h2>转介绍</h2>
      <dl class="kv">
        <dt>推荐人</dt><dd>
% if referrer:
          <a href="/customers/{{referrer['id']}}">{{referrer['name']}}</a>
% else:
          —
% end
        </dd>
        <dt>他推荐的人</dt><dd>
% if referred:
%   for r in referred:
          <a href="/customers/{{r['id']}}">{{r['name']}}</a><small>（{{r['status']}}）</small>
%   end
% else:
          —
% end
        </dd>
      </dl>
    </section>

% if can_delete:
    <form method="post" action="/customers/{{c['id']}}/delete" data-confirm="确定删除 {{c['name']}} 吗？跟进记录会一起删除，不能恢复。" class="no-print">
      <input type="hidden" name="_csrf" value="{{csrf}}">
      <button type="submit" class="btn btn-danger btn-sm">删除这个客户</button>
    </form>
% end
  </div>
</div>
