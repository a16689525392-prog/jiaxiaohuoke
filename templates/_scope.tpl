% if can_all:
<span class="seg" role="group" aria-label="范围">
  <a href="{{req.url(mine='1', page=None)}}" class="{{'on' if mine else ''}}">我负责的</a>
  <a href="{{req.url(mine='0', page=None)}}" class="{{'' if mine else 'on'}}">全部</a>
</span>
% end
