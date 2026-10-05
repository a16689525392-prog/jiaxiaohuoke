% rebase('base.tpl')
<div class="page-head">
  <div>
    <h1>导出与备份</h1>
    <p class="sub">导出的表格里有客户和学员的个人信息，只在业务需要时导出，不要发到公开群里。</p>
  </div>
</div>

<section class="card flush">
  <div class="card-head"><h2>导出成表格</h2><span class="muted">CSV 格式，Excel 和 WPS 都能直接打开</span></div>
  <div class="table-wrap">
  <table class="table">
    <thead><tr><th>内容</th><th class="right">条数</th><th></th></tr></thead>
    <tbody>
% for kind in ['customers', 'followups', 'students', 'issues']:
      <tr>
        <td><strong>{{exports[kind][0]}}</strong></td>
        <td class="right num">{{counts[kind]}}</td>
        <td class="tight"><a class="btn btn-sm" href="/admin/export/{{kind}}.csv">下载</a></td>
      </tr>
% end
    </tbody>
  </table>
  </div>
</section>

<section class="card flush">
  <div class="card-head">
    <h2>数据库备份</h2>
    <form method="post" action="/admin/backup" class="inline-form">
      <input type="hidden" name="_csrf" value="{{csrf}}">
      <button type="submit" class="btn btn-sm btn-primary">现在备份一次</button>
    </form>
  </div>
  <p class="card-note">系统每天凌晨 3 点以后自动备份一次，保留最近 {{keep}} 份，放在服务器的 <code>{{backup_dir}}</code>。备份文件和数据库在同一台机器上，机器坏了会一起丢，建议定期下载一份存到别处。</p>
% if backups:
  <div class="table-wrap">
  <table class="table">
    <thead><tr><th>备份文件</th><th class="right">大小</th><th></th></tr></thead>
    <tbody>
%   for name, size in backups:
      <tr>
        <td><code>{{name}}</code></td>
        <td class="right num">{{'%.1f MB' % (size / 1048576.0) if size >= 1048576 else '%d KB' % max(1, size // 1024)}}</td>
        <td class="tight"><a class="btn btn-sm" href="/admin/backup/{{name}}">下载</a></td>
      </tr>
%   end
    </tbody>
  </table>
  </div>
% else:
  <div class="empty">还没有备份。</div>
% end
</section>
<p class="hint">要恢复到某一份备份，在服务器上运行 <code>sudo jiaxiao restore 备份文件名</code>（Docker 部署的命令见说明文档）。恢复前会自动把当前数据再备份一次。</p>
