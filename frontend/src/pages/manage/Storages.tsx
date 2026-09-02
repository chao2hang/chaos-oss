import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  message,
  Input,
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  EmptyState,
  Skeleton,
} from "@chaos_team/chaos-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  HardDriveIcon,
  PowerIcon,
  Trash2Icon,
  PencilIcon,
  PlusIcon,
  FolderIcon,
  CloudIcon,
  CircleCheckIcon,
  CircleXIcon,
  TriangleAlertIcon,
  DownloadIcon,
  UploadIcon,
} from "lucide-react";
import {
  listStorages,
  deleteStorage,
  enableStorage,
  updateStorage,
  exportStorages,
} from "../../api/admin";
import type { Storage } from "../../api/types";
import { ArrowUpIcon, ArrowDownIcon, RadarIcon, SquareIcon } from "lucide-react";
import { scanStart, scanStop, scanProgress } from "../../api/admin";
import StorageFormDialog from "./AddStorageDialog";
import StorageImportDialog from "./StorageImportDialog";
import { useI18n } from '../../i18n'

export default function ManageStorages() {
  const { t } = useI18n()
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "storages"],
    queryFn: listStorages,
  });

  // add / edit dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Storage | null>(null);

  // import dialog state
  const [importOpen, setImportOpen] = useState(false);

  // selected storage ids for partial export
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const storages = list.data?.content ?? [];
  // only ids still present in the list count (a selection may go stale
  // after a delete or refresh)
  const liveSelected = storages.filter((s) => selected.has(s.id));
  const allSelected =
    storages.length > 0 && liveSelected.length === storages.length;

  /** Download the (selected or all) channel configs as a JSON file. */
  const doExport = async () => {
    const ids = liveSelected.map((s) => s.id);
    try {
      const data = await exportStorages(ids.length > 0 ? ids : undefined);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date()
        .toISOString()
        .replace(/[:T]/g, "-")
        .slice(0, 19);
      a.href = url;
      a.download = `chaos-oss-storages-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(
        t("已导出 {n} 个渠道，文件包含凭据，请妥善保管", {
          n: data.storages.length,
        }),
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  };

  const del = useMutation({
    mutationFn: deleteStorage,
    onSuccess: () => {
      message.success(t("已删除"));
      qc.invalidateQueries({ queryKey: ["admin", "storages"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      enableStorage(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "storages"] }),
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  /** Swap the order of two storages (list order is the mount order). */
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= storages.length) return;
    const a = storages[i];
    const b = storages[j];
    try {
      await updateStorage({ ...a, order: j });
      await updateStorage({ ...b, order: i });
      qc.invalidateQueries({ queryKey: ["admin", "storages"] });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "排序失败");
    }
  };

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('存储')}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('已挂载的后端存储，共 {n} 个', { n: storages.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={list.isLoading || storages.length === 0}
            title={
              liveSelected.length > 0
                ? t('导出选中的 {n} 个渠道', { n: liveSelected.length })
                : t('导出全部渠道')
            }
            onClick={doExport}
          >
            <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
            {liveSelected.length > 0
              ? t('导出 ({n})', { n: liveSelected.length })
              : t('导出')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <UploadIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('导入')}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('添加存储')}
          </Button>
        </div>
      </div>

      <ScanCard />

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[36px]">
                <Checkbox
                  aria-label={t('全选')}
                  checked={allSelected}
                  indeterminate={liveSelected.length > 0 && !allSelected}
                  onCheckedChange={(checked) => {
                    setSelected(
                      checked
                        ? new Set(storages.map((s) => s.id))
                        : new Set(),
                    )
                  }}
                />
              </TableHead>
              <TableHead className="w-[34%]">{t('挂载路径')}</TableHead>
              <TableHead className="w-[18%]">{t('驱动')}</TableHead>
              <TableHead className="w-[14%]">{t('状态')}</TableHead>
              <TableHead className="w-[14%]">{t('缓存')}</TableHead>
              <TableHead className="w-[20%] text-right">{t('操作')}</TableHead>
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
            ) : storages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={HardDriveIcon}
                    title={t("暂无存储")}
                    description="还没有挂载任何存储后端"
                  />
                </TableCell>
              </TableRow>
            ) : (
              storages.map((s, idx) => (
                <TableRow key={s.id} data-state={selected.has(s.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={t('选择') + ' ' + s.mount_path}
                      checked={selected.has(s.id)}
                      onCheckedChange={(checked) =>
                        toggleSelect(s.id, checked)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                      {s.mount_path}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <CloudIcon className="h-3.5 w-3.5 shrink-0" />
                      {s.driver}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.disabled ? "destructive" : "secondary"}>
                      <span className="flex items-center gap-1">
                        {s.disabled ? (
                          <CircleXIcon className="h-3 w-3" />
                        ) : s.status === "work" ? (
                          <CircleCheckIcon className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <TriangleAlertIcon className="h-3 w-3 text-amber-400" />
                        )}
                        {s.disabled
                          ? t('已禁用')
                          : s.status === "work"
                            ? t('正常')
                            : s.status}
                      </span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {s.cache_expiration}s
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("上移")}
                        disabled={idx === 0}
                        onClick={() => move(idx, -1)}
                      >
                        <ArrowUpIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("下移")}
                        disabled={idx === storages.length - 1}
                        onClick={() => move(idx, 1)}
                      >
                        <ArrowDownIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("编辑")}
                        onClick={() => setEditTarget(s)}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={s.disabled ? t('启用') : t('禁用')}
                        onClick={() =>
                          toggle.mutate({ id: s.id, enabled: s.disabled })
                        }
                      >
                        <PowerIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("删除")}
                        onClick={() => {
                          if (confirm(`删除存储 ${s.mount_path}？`)) {
                            del.mutate(s.id);
                          }
                        }}
                      >
                        <Trash2Icon className="h-4 w-4 text-destructive" />
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* add / edit dialogs */}
      <StorageFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <StorageFormDialog
        editStorage={editTarget}
        open={editTarget !== null}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
      />
      <StorageImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}


/** Manual scan controls + progress (admin). */
function ScanCard() {
  const { t } = useI18n()
  const qc = useQueryClient();
  const [path, setPath] = useState("/");
  const [busy, setBusy] = useState(false);
  const progress = useQuery({
    queryKey: ["admin", "scan-progress"],
    queryFn: scanProgress,
    refetchInterval: 2000,
  });
  const running = progress.data ? !progress.data.is_done : false;

  const start = async () => {
    setBusy(true);
    try {
      await scanStart(path, 0);
      message.success(t("已开始扫描"));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "启动失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-4">
      <RadarIcon className={`h-4 w-4 ${running ? "animate-pulse text-primary" : "text-muted-foreground"}`} />
      <span className="text-sm font-medium">{t('手动扫描')}</span>
      <Input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={t("路径（如 / 或 /存储名）")}
        className="h-8 w-52 font-mono text-xs"
      />
      <Button size="sm" variant="outline" disabled={busy || running} onClick={start}>
        {t('开始')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!running}
        onClick={() =>
          scanStop().catch((e) => message.error(e instanceof Error ? e.message : "停止失败"))
        }
      >
        <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
        {t('停止')}
      </Button>
      {progress.data && (
        <span className="ml-1 text-xs text-muted-foreground">
          {running ? t('扫描中… 已扫描 {n} 项', { n: progress.data.obj_count.toLocaleString() }) : t('共 {n} 项', { n: progress.data.obj_count.toLocaleString() })}
        </span>
      )}
      {running && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin", "scan-progress"] })}
        >
          {t('刷新')}
        </button>
      )}
    </div>
  );
}
