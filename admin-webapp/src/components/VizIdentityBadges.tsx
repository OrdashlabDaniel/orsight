/** 注册用户 / 后台管理员 标签（用量看板等复用） */
export function VizIdentityBadges({
  isRegisteredUser,
  isAdmin,
}: {
  isRegisteredUser: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <span
          className={
            isRegisteredUser
              ? "rounded-md bg-slate-800 px-2 py-0.5 text-xs font-medium text-white"
              : "rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400 line-through"
          }
          title="auth.users 中的注册账号"
        >
          注册用户
        </span>
        <span
          className={
            isAdmin
              ? "rounded-md bg-blue-600 px-2 py-0.5 text-xs font-medium text-white"
              : "rounded-md border border-dashed border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-400"
          }
          title="public.admin_users 中有记录，可进后台"
        >
          后台管理员
        </span>
      </div>
      {isRegisteredUser && isAdmin ? (
        <p className="text-[11px] leading-snug text-slate-500">该账号同时具备以上两种身份</p>
      ) : null}
    </div>
  );
}
