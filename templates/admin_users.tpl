% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>成员账号</h1>
    <p class="sub">每人一个账号。客户和学员的“负责人”从这里选。人走了就停用账号，他名下的记录都保留。</p>
  </div>
  <div class="actions"><a class="btn btn-primary" href="/admin/users/new">＋ 新增成员</a></div>
</div>
<section class="card flush">
  <div class="table-wrap">
  <table class="table rows">
    <thead><tr><th>显示名称</th><th>用户名</th><th>角色</th><th>状态</th><th class="right">负责的客户</th><th class="right">负责的学员</th><th class="col-opt">最近登录</th><th></th></tr></thead>
    <tbody>
% for u in users:
      <tr class="{{'' if u['active'] else 'is-dim'}}">
        <td class="r-main"><strong>{{u['display_name']}}</strong>{{'（我）' if u['id'] == user['id'] else ''}}</td>
        <td class="r-meta"><code>{{u['username']}}</code></td>
        <td>{{'管理员' if u['role'] == 'admin' else '成员'}}</td>
        <td><span class="chip {{'chip-green' if u['active'] else ''}}">{{'在用' if u['active'] else '已停用'}}</span></td>
        <td class="right num r-meta"><span class="r-label">客户 </span>{{u['customers']}}</td>
        <td class="right num r-meta"><span class="r-label">学员 </span>{{u['students']}}</td>
        <td class="col-opt r-meta"><span class="r-label">最近登录 </span>{{fmt_dt(u['last_login_at']) or '还没登录过'}}</td>
        <td class="tight r-act"><a class="btn btn-sm" href="/admin/users/{{u['id']}}/edit">修改</a></td>
      </tr>
% end
    </tbody>
  </table>
  </div>
</section>
<p class="hint">管理员能看到全部数据，能改产品卡、话术、渠道和规则。成员能看到什么，在“系统设置”里定。</p>
