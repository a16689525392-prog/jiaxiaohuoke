% if pg['pages'] > 1:
<div class="pager">
  <span>共 {{pg['total']}} 条，第 {{pg['page']}} / {{pg['pages']}} 页</span>
%   if pg['page'] > 1:
  <a class="btn btn-sm" href="{{req.url(page=pg['page'] - 1)}}">上一页</a>
%   end
%   if pg['page'] < pg['pages']:
  <a class="btn btn-sm" href="{{req.url(page=pg['page'] + 1)}}">下一页</a>
%   end
</div>
% end
