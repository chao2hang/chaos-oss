import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  EmptyState,
  Skeleton,
} from '@chaos_team/chaos-ui'
import { UserRoundIcon, UsersIcon, Trash2Icon, ShieldOffIcon } from 'lucide-react'
import { listUsers, deleteUser } from '../../api/admin'
import { cancel2FA } from '../../api/me'
import { USER_ROLE } from '../../api/types'
import { useI18n } from '../../i18n'

function roleLabel(role: number, t: (x: string) => string): string {
  switch (role) {
    case USER_ROLE.ADMIN:
      return t('管理员')
    case USER_ROLE.GUEST:
      return t('访客')
    default:
      return t('用户')
  }
}
export default function ManageUsers() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['admin', 'users'], queryFn: listUsers })

  const del = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      message.success(t('已删除'))
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (e) => message.error(e instanceof Error ? e.message : t('删除失败')),
  })

  const unbind2FA = (id: number, name: string) => {
    if (!confirm(`取消用户 ${name} 的两步验证？`)) return
    cancel2FA(id).then(
      () => {
        message.success(t('已取消两步验证'))
        qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      },
      (e) => message.error(e instanceof Error ? e.message : t('操作失败')),
    )
  }

  const users = list.data?.content ?? []

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">{t('用户')}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('共 {n} 个账户', { n: users.length })}</p>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[8%]">ID</TableHead>
              <TableHead className="w-[22%]">{t('用户名')}</TableHead>
              <TableHead className="w-[14%]">{t('角色')}</TableHead>
              <TableHead className="w-[12%]">{t('状态')}</TableHead>
              <TableHead className="w-[30%]">{t('根路径')}</TableHead>
              <TableHead className="w-[14%] text-right">{t('操作')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={UsersIcon}
                    title={t("暂无用户")}
                  />
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {u.id}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <UserRoundIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {u.username}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === USER_ROLE.ADMIN ? 'default' : 'secondary'}>
                      {roleLabel(u.role, t)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.disabled ? 'destructive' : 'secondary'}>
                      {u.disabled ? t('禁用') : t('正常')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {u.base_path}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {u.role !== USER_ROLE.GUEST && u.role !== USER_ROLE.ADMIN && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("取消两步验证")}
                          onClick={() => unbind2FA(u.id, u.username)}
                        >
                          <ShieldOffIcon className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("删除")}
                        onClick={() => {
                          if (confirm(`删除用户 ${u.username}？`)) {
                            del.mutate(u.id)
                          }
                        }}
                      >
                        <Trash2Icon className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
