import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  message,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Alert,
  AlertDescription,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@chaos_team/chaos-ui";
import {
  UploadIcon,
  FileJsonIcon,
  TriangleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  MinusCircleIcon,
  RefreshCcwIcon,
} from "lucide-react";
import {
  listStorages,
  importStorages,
  type StorageExportFile,
  type StorageImportSummary,
} from "../../api/admin";
import { useI18n } from "../../i18n";

/** Result badge for a single imported channel. */
function ActionBadge({ action }: { action: string }) {
  const { t } = useI18n();
  const map: Record<
    string,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    created: {
      label: t("已创建"),
      cls: "bg-emerald-500/15 text-emerald-500",
      icon: <CircleCheckIcon className="h-3 w-3" />,
    },
    updated: {
      label: t("已更新"),
      cls: "bg-blue-500/15 text-blue-400",
      icon: <RefreshCcwIcon className="h-3 w-3" />,
    },
    skipped: {
      label: t("已跳过"),
      cls: "bg-muted text-muted-foreground",
      icon: <MinusCircleIcon className="h-3 w-3" />,
    },
    failed: {
      label: t("失败"),
      cls: "bg-destructive/15 text-destructive",
      icon: <CircleXIcon className="h-3 w-3" />,
    },
  };
  const v = map[action] ?? map.failed;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${v.cls}`}
    >
      {v.icon}
      {v.label}
    </span>
  );
}

/**
 * Import channels (storages) from a JSON file previously produced by the
 * export button / endpoint. Parses and previews the file first, then
 * imports with a skip-or-overwrite strategy for existing mount paths.
 */
export default function StorageImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [payload, setPayload] = useState<StorageExportFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [strategy, setStrategy] = useState<"skip" | "overwrite">("skip");
  const [summary, setSummary] = useState<StorageImportSummary | null>(null);
  const [importing, setImporting] = useState(false);

  // current storages, to mark which imported mount paths already exist
  const list = useQuery({
    queryKey: ["admin", "storages"],
    queryFn: listStorages,
    enabled: open,
  });
  const existingPaths = new Set(
    (list.data?.content ?? []).map((s) => s.mount_path),
  );

  const reset = () => {
    setPayload(null);
    setFileName("");
    setParseError("");
    setStrategy("skip");
    setSummary(null);
  };

  const pickFile = async (file: File | undefined | null) => {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setSummary(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as StorageExportFile;
      if (!data || typeof data !== "object") {
        throw new Error(t("不是有效的导出文件"));
      }
      if (!Array.isArray(data.storages) || data.storages.length === 0) {
        throw new Error(t("文件中没有渠道配置"));
      }
      for (const s of data.storages) {
        if (!s || typeof s !== "object" || typeof s.mount_path !== "string") {
          throw new Error(t("文件中包含无效的渠道条目"));
        }
      }
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setParseError(
        e instanceof Error
          ? `${t("解析文件失败")}：${e.message}`
          : t("解析文件失败"),
      );
    }
  };

  const runImport = async () => {
    if (!payload) return;
    setImporting(true);
    try {
      const res = await importStorages(payload.storages, strategy);
      setSummary(res);
      if (res.failed === 0) {
        message.success(
          t("导入完成：新建 {a}，更新 {b}，跳过 {c}", {
            a: res.created,
            b: res.updated,
            c: res.skipped,
          }),
        );
      } else {
        message.error(t("导入完成，但有 {n} 个失败", { n: res.failed }));
      }
      qc.invalidateQueries({ queryKey: ["admin", "storages"] });
    } catch (e) {
      message.error(e instanceof Error ? e.message : t("导入失败"));
    } finally {
      setImporting(false);
    }
  };

  const existingCount = payload
    ? payload.storages.filter((s) => existingPaths.has(s.mount_path)).length
    : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("导入渠道")}</DialogTitle>
          <DialogDescription>
            {t("从导出的 JSON 文件恢复渠道配置")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-hidden">
          {!summary ? (
            <div className="space-y-4">
              {/* file picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <UploadIcon className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {fileName ? fileName : t("选择导出的 JSON 文件")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("点击选择文件，文件中包含渠道的完整配置")}
                </span>
              </button>

              {parseError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <CircleXIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {parseError}
                </div>
              )}

              {payload && (
                <>
                  {/* preview */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <FileJsonIcon className="h-3.5 w-3.5" />
                      {t("文件预览")}
                    </span>
                    <span>
                      {t("共 {n} 个渠道", { n: payload.storages.length })}
                    </span>
                    {existingCount > 0 && (
                      <span>
                        {t("其中 {n} 个挂载路径已存在", { n: existingCount })}
                      </span>
                    )}
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("挂载路径")}</TableHead>
                          <TableHead>{t("驱动")}</TableHead>
                          <TableHead className="w-[30%]">
                            {t("状态")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payload.storages.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">
                              {s.mount_path}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {s.driver}
                            </TableCell>
                            <TableCell>
                              {existingPaths.has(s.mount_path) ? (
                                <Badge variant="secondary">
                                  {t("已存在")}
                                </Badge>
                              ) : (
                                <Badge variant="outline">{t("新增")}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* strategy */}
                  <div className="space-y-2">
                    <Label className="text-xs">
                      {t("冲突处理（挂载路径已存在时）")}
                    </Label>
                    <RadioGroup
                      value={strategy}
                      onValueChange={(v) => setStrategy(v as "skip" | "overwrite")}
                      className="flex flex-col gap-2"
                    >
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-xs">
                        <RadioGroupItem value="skip" className="mt-0.5" />
                        <span>
                          <span className="font-medium">{t("跳过已存在")}</span>
                          <span className="block text-muted-foreground">
                            {t("保留现有配置，只导入不存在的渠道")}
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-xs">
                        <RadioGroupItem value="overwrite" className="mt-0.5" />
                        <span>
                          <span className="font-medium">{t("覆盖已存在")}</span>
                          <span className="block text-muted-foreground">
                            {t("用文件中的配置更新现有渠道")}
                          </span>
                        </span>
                      </label>
                    </RadioGroup>
                  </div>

                  {strategy === "overwrite" && existingCount > 0 && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon className="h-4 w-4" />
                      <AlertDescription>
                        {t(
                          "覆盖会用文件中的配置替换现有渠道的设置（包括凭据），且不可撤销。",
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}
            </div>
          ) : (
            /* import result */
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <ActionStat label={t("新建")} n={summary.created} cls="text-emerald-500" />
                <ActionStat label={t("更新")} n={summary.updated} cls="text-blue-400" />
                <ActionStat label={t("跳过")} n={summary.skipped} cls="text-muted-foreground" />
                <ActionStat label={t("失败")} n={summary.failed} cls="text-destructive" />
              </div>
              <ScrollArea className="max-h-64 rounded-md border border-border">
                <div className="divide-y divide-border">
                  {summary.results.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2">
                      <ActionBadge action={r.action} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">
                          {r.mount_path}
                          <span className="ml-1.5 text-muted-foreground">
                            {r.driver}
                          </span>
                        </div>
                        {r.error && (
                          <div className="mt-0.5 break-words text-xs text-muted-foreground">
                            {r.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {!summary ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("取消")}
              </Button>
              <Button
                disabled={!payload || importing}
                onClick={runImport}
              >
                {importing ? t("导入中…") : t("开始导入")}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>{t("完成")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionStat({
  label,
  n,
  cls,
}: {
  label: string;
  n: number;
  cls: string;
}) {
  return (
    <span className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <span className="text-muted-foreground">{label} </span>
      <span className={`font-semibold tabular-nums ${cls}`}>{n}</span>
    </span>
  );
}
