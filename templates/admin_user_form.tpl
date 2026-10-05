% rebase('base.tpl')
% new = u is None
% fv = lambda k, d='': (f.get(k) if posted else (str(u[k]) if not new else d))
<div class="page-head"><div><h1>{{'新增成员' if new else '修改账号：' + u['username']}}</h1></div></div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<form method="post" action="{{'/admin/users/new' if new else '/admin/users/%d/edit' % u['id']}}" class="stack" autocomplete="off">
  <input type="hidden" name="_csrf" value="{{csrf}}">
  <section class="card">
    <div class="form-grid">
% if new:
      <label class="field"><span>用户名＊</span>
        <input type="text" name="username" value="{{fv('username')}}" required autocomplete="off">
        <small>登录用，2–32 位，建好后不能改。</small></label>
% end
      <label class="field"><span>显示名称＊</span>
        <input type="text" name="display_name" value="{{fv('display_name')}}" maxlength="20" required placeholder="例如：小周"></label>
      <label class="field"><span>角色</span>
        <select name="role">
          <option value="member" {{'selected' if fv('role', 'member') == 'member' else ''}}>成员</option>
          <option value="admin" {{'selected' if fv('role', 'member') == 'admin' else ''}}>管理员</option>
        </select></label>
      <label class="field"><span>{{'初始密码＊' if new else '重置密码（不改就留空）'}}</span>
        <input type="password" name="password" autocomplete="new-password" minlength="8" {{'required' if new else ''}}>
        <small>至少 8 位。{{'' if new else '填了新密码，他在其他设备上的登录会全部退出。'}}</small></label>
% if new:
      <input type="hidden" name="active" value="1">
% else:
      <label class="check wide"><input type="checkbox" name="active" value="1" {{'checked' if fv('active', '1') == '1' else ''}}>
        <span class="check-body"><strong>账号在用</strong><small>取消勾选就是停用：不能再登录，他名下的客户和学员都保留，可以改给别人负责。</small></span></label>
% end
    </div>
  </section>
  <div class="form-actions">
    <button type="submit" class="btn btn-primary">保存</button>
    <a class="btn" href="/admin/users">取消</a>
  </div>
</form>
% if not new:
<section class="card">
  <h2>把名下的记录转给别人</h2>
  <p class="card-note">成员离开或者换分工时用。现在由 {{u['display_name']}} 负责的：在跟的客户 {{owned['customers'][0]}} 个（全部 {{owned['customers'][1]}} 个），交付中的学员 {{owned['students'][0]}} 个（全部 {{owned['students'][1]}} 个），没关闭的异常 {{owned['issues'][0]}} 条（全部 {{owned['issues'][1]}} 条）。</p>
%   if not others:
  <p class="muted">还没有其他在用的成员可以接手。</p>
%   elif not (owned['customers'][1] or owned['students'][1] or owned['issues'][1]):
  <p class="muted">他名下没有记录，不需要转交。</p>
%   else:
  <form method="post" action="/admin/users/{{u['id']}}/transfer" class="filters" data-confirm="确定把这些记录转给选中的成员吗？">
    <input type="hidden" name="_csrf" value="{{csrf}}">
    <label class="field"><span>转给</span>
      <select name="to_user" required>
        <option value="">请选择</option>
%     for x in others:
        <option value="{{x['id']}}">{{x['display_name']}}</option>
%     end
      </select></label>
    <label class="field"><span>转哪些</span>
      <select name="scope">
        <option value="open">只转还在进行的</option>
        <option value="all">全部，包括已结束的</option>
      </select></label>
    <button type="submit" class="btn">转交</button>
  </form>
  <p class="hint">“还在进行的”指在跟的客户、交付中的学员和没关闭的异常。已结束的留在原负责人名下，统计口径不变。每个客户的跟进记录里会留一条转交说明。</p>
%   end
</section>
% end
