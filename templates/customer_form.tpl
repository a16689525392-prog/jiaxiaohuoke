% rebase('base.tpl')
% val = lambda k, d='': (f.get(k) if posted else (str(c[k]) if c is not None and c[k] is not None else d))
% new = c is None
<div class="page-head">
  <div>
    <h1>{{'登记客户' if new else '编辑资料：' + c['name']}}</h1>
    <p class="sub">只登记业务必要的信息，不登记身份证号。{{'分级、状态和跟进时间，在客户页面的“记录跟进”里改。' if not new else ''}}</p>
  </div>
</div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end

<form method="post" action="{{'/customers/new' if new else '/customers/%d/edit' % c['id']}}" class="stack">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <h2>登记</h2>
    <div class="form-grid">
      <label class="field"><span>称呼（微信备注名）＊</span>
        <input type="text" name="name" value="{{val('name')}}" maxlength="40" required {{'autofocus' if new else ''}}></label>
      <label class="field"><span>微信号 / 联系方式</span>
        <input type="text" name="contact" value="{{val('contact')}}" maxlength="60"></label>
      <label class="field"><span>来源渠道＊</span>
        <select name="channel_id" required>
          <option value="">请选择</option>
% for ch in channels:
          <option value="{{ch['id']}}" {{'selected' if val('channel_id') == str(ch['id']) else ''}}>{{ch['name']}}{{'（已停用）' if ch['archived'] else ''}}</option>
% end
        </select>
        <small>记录客户从哪里来，后面才知道哪个渠道有效。</small></label>
      <label class="field"><span>推荐人（转介绍时选）</span>
        <select name="referrer_id">
          <option value="">无</option>
% for r in referrers:
          <option value="{{r['id']}}" {{'selected' if val('referrer_id') == str(r['id']) else ''}}>{{r['name']}}{{'' if r['status'] == '已正式报名' else '（' + r['status'] + '）'}}</option>
% end
        </select>
        <small>列表里是已报名的学员。推荐人还没登记的，先把他登记进来。</small></label>
      <label class="field"><span>登记日期</span>
        <input type="date" name="registered_on" value="{{val('registered_on', today)}}" max="{{today}}"></label>
      <label class="field"><span>学校 / 区域</span>
        <input type="text" name="school" value="{{val('school')}}" maxlength="60"></label>
% if can_all:
      <label class="field"><span>负责人</span>
        <select name="owner_id">
%   for u in users:
          <option value="{{u['id']}}" {{'selected' if val('owner_id', str(user['id'])) == str(u['id']) else ''}}>{{u['display_name']}}{{'' if u['active'] else '（已停用）'}}</option>
%   end
        </select></label>
% end
    </div>
  </section>

  <section class="card">
    <h2>需求</h2>
    <p class="card-note">需求问清楚，班型才匹配得准：想学什么车型、平时在哪、周一到周五有没有时间、最在意什么。</p>
    <div class="form-grid">
      <label class="field"><span>想学车型</span>
        <select name="vehicle">
          <option value="">未填</option>
% for v in consts.VEHICLES:
          <option value="{{v}}" {{'selected' if val('vehicle') == v else ''}}>{{v}}</option>
% end
        </select></label>
      <label class="field"><span>计划报名时间</span>
        <select name="plan">
          <option value="">未填</option>
% for v in consts.PLANS:
          <option value="{{v}}" {{'selected' if val('plan') == v else ''}}>{{v}}</option>
% end
        </select></label>
      <label class="field"><span>可练车时间</span>
        <input type="text" name="slots" value="{{val('slots')}}" maxlength="80" placeholder="例如：周末全天；周三下午"></label>
      <label class="field"><span>预算范围</span>
        <input type="text" name="budget" value="{{val('budget')}}" maxlength="40" placeholder="例如：3500–4000"></label>
      <label class="field"><span>最关心的问题</span>
        <input type="text" name="concern" value="{{val('concern')}}" maxlength="20" list="concerns">
        <datalist id="concerns">
% for v in consts.CONCERNS:
          <option value="{{v}}"></option>
% end
        </datalist></label>
      <label class="field"><span>匹配班型</span>
        <select name="product_id">
          <option value="">还没匹配</option>
% for p in products:
          <option value="{{p['id']}}" {{'selected' if val('product_id') == str(p['id']) else ''}}>{{p['name'] or '未命名班型'}}{{'（已停用）' if p['archived'] else ''}}</option>
% end
        </select></label>
    </div>
  </section>

% if new:
  <section class="card">
    <h2>分级和下一步</h2>
    <div class="stack">
      <label class="field"><span>沟通要点 / 客户顾虑</span>
        <textarea name="notes" rows="3" maxlength="2000" placeholder="问到了什么、对方担心什么">{{f.raw('notes') if posted else ''}}</textarea></label>
      <div class="field"><span class="label">分级（看行为，不看第一印象）</span>
        <div class="radio-row">
          <label><input type="radio" name="grade" value="" {{'checked' if val('grade') == '' else ''}}> 先不分级</label>
%   for g in consts.GRADES:
          <label title="{{consts.GRADE_HELP[g]}}"><input type="radio" name="grade" value="{{g}}" {{'checked' if val('grade') == g else ''}}> {{g}}</label>
%   end
        </div>
        <ul class="help-list">
%   for g in consts.GRADES:
          <li><strong>{{g}}</strong>：{{consts.GRADE_HELP[g]}}</li>
%   end
        </ul>
      </div>
      <div class="form-grid">
        <label class="field"><span>当前状态</span>
          <select name="status">
%   for s in consts.OPEN_STATUSES + ['暂不跟进']:
            <option value="{{s}}" {{'selected' if val('status', '新加微信') == s else ''}}>{{s}}</option>
%   end
          </select></label>
        <label class="field"><span>下一步动作</span>
          <input type="text" name="next_action" value="{{val('next_action')}}" maxlength="120" placeholder="例如：发产品卡，问清周末有没有空"></label>
        <div class="field"><label for="next_follow_on" class="label">下次跟进时间＊</label>
          <input type="date" id="next_follow_on" name="next_follow_on" value="{{val('next_follow_on')}}" min="{{today}}">
          <div class="quick-dates">
            <button type="button" data-set-date="next_follow_on" data-days="0">今天</button>
            <button type="button" data-set-date="next_follow_on" data-days="1">明天</button>
            <button type="button" data-set-date="next_follow_on" data-days="2">后天</button>
            <button type="button" data-set-date="next_follow_on" data-days="3">3 天后</button>
            <button type="button" data-set-date="next_follow_on" data-days="7">一周后</button>
          </div>
          <small>D 类和“暂不跟进”可以不填，其他都要填。</small></div>
      </div>
    </div>
  </section>
% end

  <section class="card">
    <label class="field"><span>备注</span>
      <textarea name="remark" rows="2" maxlength="1000">{{f.raw('remark') if posted else (c['remark'] if c is not None else '')}}</textarea></label>
  </section>

  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
% if new:
    <button type="submit" name="again" value="1" class="btn">保存并继续登记下一个</button>
% end
    <a class="btn" href="{{'/customers' if new else '/customers/%d' % c['id']}}">取消</a>
  </div>
</form>
