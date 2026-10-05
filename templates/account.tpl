% rebase('base.tpl')
<div class="page-head"><h1>我的账号</h1></div>
% for e in errors:
<div class="flash flash-err">{{e}}</div>
% end
<div class="grid-2">
  <section class="card">
    <h2>基本信息</h2>
    <form method="post" action="/account" class="stack">
      <input type="hidden" name="_csrf" value="{{csrf}}">
      <input type="hidden" name="action" value="profile">
      <label class="field"><span>用户名</span><input type="text" value="{{user['username']}}" disabled></label>
      <label class="field"><span>显示名称</span>
        <input type="text" name="display_name" value="{{user['display_name']}}" maxlength="20" required>
        <small>客户和学员的“负责人”显示的就是这个名字。</small></label>
      <div><button type="submit" class="btn btn-primary">保存</button></div>
    </form>
  </section>
  <section class="card">
    <h2>修改密码</h2>
    <form method="post" action="/account" class="stack">
      <input type="hidden" name="_csrf" value="{{csrf}}">
      <input type="hidden" name="action" value="password">
      <label class="field"><span>当前密码</span>
        <input type="password" name="old_password" autocomplete="current-password" required></label>
      <label class="field"><span>新密码</span>
        <input type="password" name="new_password" autocomplete="new-password" minlength="8" required>
        <small>至少 8 位。</small></label>
      <label class="field"><span>再输一次新密码</span>
        <input type="password" name="new_password2" autocomplete="new-password" minlength="8" required></label>
      <div><button type="submit" class="btn btn-primary">修改密码</button></div>
    </form>
  </section>
</div>
