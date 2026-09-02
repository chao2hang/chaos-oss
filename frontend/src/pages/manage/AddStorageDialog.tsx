import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  message,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@chaos_team/chaos-ui";
import {
  listDrivers,
  createStorage,
  updateStorage,
  pan123OAuthInfo,
  pan123OAuthToken,
  cloud189Login,
  type DriverItem,
} from "../../api/admin";
import type { Storage } from "../../api/types";
import { useI18n } from "../../i18n";
import { driverFieldLabel } from "../../lib/driverFieldLabels";

/** Parse Item.options — it is a JSON array string like ["a","b"]. */
function parseOptions(item: DriverItem): string[] {
  try {
    const v = JSON.parse(item.options);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Field renderer driven by the backend-provided driver.Item schema. */
function SchemaField({
  item,
  value,
  onChange,
}: {
  item: DriverItem;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const def = item.default;
  if (item.type === "bool") {
    const checked = value === undefined ? def === "true" : Boolean(value);
    return <Switch checked={checked} onCheckedChange={onChange} />;
  }
  if (item.type === "number") {
    return (
      <Input
        name={item.name}
        type="number"
        value={value === undefined ? def : String(value)}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
      />
    );
  }
  if (item.type === "select") {
    const opts = parseOptions(item);
    return (
      <Select value={String(value ?? def)} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      name={item.name}
      value={value === undefined ? def : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function StorageFormDialog({
  editStorage = null,
  open,
  onOpenChange,
}: {
  /** the storage being edited; null = add mode */
  editStorage?: Storage | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n()
  const qc = useQueryClient();
  const isEdit = !!editStorage;
  const [driverName, setDriverName] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  /** suggestion list visibility: typing shows it, picking an item hides it */
  const [driverListOpen, setDriverListOpen] = useState(false);
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >({});
  // 123 OAuth helper state
  const [oauthCode, setOauthCode] = useState("");
  const [oauthBusy, setOauthBusy] = useState(false);

  // Hydrate the form when opening: edit mode loads the stored addition,
  // add mode starts clean.
  useEffect(() => {
    if (!open) return;
    if (editStorage) {
      setDriverName(editStorage.driver);
      setDriverSearch(editStorage.driver);
      const vals: Record<string, string | number | boolean> = {
        mount_path: editStorage.mount_path,
        order: editStorage.order,
        remark: editStorage.remark ?? "",
        cache_expiration: editStorage.cache_expiration,
      };
      try {
        const add = JSON.parse(editStorage.addition || "{}") as Record<
          string,
          string | number | boolean
        >;
        Object.assign(vals, add);
      } catch {
        /* malformed addition — start from defaults */
      }
      setValues(vals);
      setDriverListOpen(false);
      setOauthCode("");
    } else {
      setDriverName("");
      setDriverSearch("");
      setValues({});
      setDriverListOpen(false);
      setOauthCode("");
      setC189State("");
      setC189Captcha("");
      setC189VCode("");
    }
  }, [open, editStorage]);

  const drivers = useQuery({
    queryKey: ["admin", "drivers"],
    queryFn: listDrivers,
    enabled: open,
    staleTime: 10 * 60_000,
  });

  const oauthInfo = useQuery({
    queryKey: ["admin", "123pan", "oauth_info"],
    queryFn: pan123OAuthInfo,
    enabled: open && driverName === "123 Open",
    staleTime: 10 * 60_000,
  });

  const driverNames = useMemo(
    () => Object.keys(drivers.data ?? {}).sort((a, b) => a.localeCompare(b)),
    [drivers.data],
  );

  /** Type-ahead suggestions: only shown while typing — an empty input
   *  shows nothing (a click on the empty input must not pop the list;
   *  a huge all-drivers list also breaks the popup positioning). */
  const filteredDrivers = useMemo(() => {
    const f = driverSearch.trim().toLowerCase();
    if (!f) return [];
    return driverNames.filter(
      (n) =>
        n.toLowerCase().includes(f) ||
        // also match the spaced label, e.g. "123open" → "123 Open"
        n.toLowerCase().replace(/\s+/g, "").includes(f.replace(/\s+/g, "")),
    );
  }, [driverNames, driverSearch]);

  const info = driverName ? drivers.data?.[driverName] : undefined;
  const commonFields = info?.common ?? [];
  const extraFields = info?.additional ?? [];

  const submit = useMutation({
    mutationFn: async () => {
      // Assemble addition from the driver's Additional fields, coercing
      // each value to the JSON type the Go struct expects: bool fields
      // must be real booleans (a "true" string fails json.Unmarshal) and
      // number fields must be numbers.
      const addition: Record<string, unknown> = {};
      for (const f of extraFields) {
        const raw = values[f.name];
        const fallback = f.default;
        if (f.type === "bool") {
          const v = raw === undefined ? fallback : raw;
          addition[f.name] = v === true || v === "true";
        } else if (f.type === "number") {
          const v = raw === undefined || raw === "" ? fallback : raw;
          const n = Number(v);
          addition[f.name] = Number.isFinite(n) ? n : 0;
        } else {
          const v = raw === undefined || raw === "" ? fallback : raw;
          addition[f.name] = v === undefined ? "" : String(v);
        }
      }
      const base = {
        mount_path: String(values["mount_path"] ?? ""),
        driver: driverName,
        addition: JSON.stringify(addition),
        order: Number(values["order"] ?? 0) || 0,
        remark: values["remark"] ? String(values["remark"]) : "",
        cache_expiration: Number(values["cache_expiration"] ?? 30) || 30,
      };
      if (isEdit) {
        return updateStorage({ ...base, id: editStorage!.id });
      }
      return createStorage(base);
    },
    onSuccess: () => {
      message.success(
        isEdit ? t('存储已更新，正在重新挂载…') : t('存储已添加，正在挂载…'),
      );
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["admin", "storages"] });
    },
    onError: (e) => {
      const msg =
        e instanceof Error ? e.message : isEdit ? t('更新失败') : t('添加失败');
      if (msg.includes("UNIQUE constraint failed")) {
        message.error(t('挂载路径已存在，请换一个路径或先删除旧存储'));
      } else {
        message.error(msg);
      }
    },
  });

  // fill the 123 Open AccessToken from an OAuth code
  const exchangeToken = async () => {
    if (!oauthCode.trim()) {
      message.error(t('请先粘贴授权 code'));
      return;
    }
    setOauthBusy(true);
    try {
      const tok = await pan123OAuthToken(oauthCode.trim());
      setValues((prev) => ({
        ...prev,
        AccessToken: tok.access_token,
        RefreshToken: tok.refresh_token,
        // Passive mode: use the freshly exchanged token directly at init
        // (no forced refresh through a third-party renewal service).
        // When the token eventually expires, the driver's 401 handler
        // refreshes it via the official OAuth endpoint instead.
        use_online_api: false,
      }));
      message.success(t('已获取 Token 并填入'));
      setOauthCode("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('换取 Token 失败'));
    } finally {
      setOauthBusy(false);
    }
  };

  // 189CloudPC login assistant: validate credentials interactively
  // (handles the image captcha) and fill the session tokens in.
  const [c189State, setC189State] = useState("");
  const [c189Captcha, setC189Captcha] = useState("");
  const [c189VCode, setC189VCode] = useState("");
  const [c189Busy, setC189Busy] = useState(false);

  const resetC189 = () => {
    setC189State("");
    setC189Captcha("");
    setC189VCode("");
  };

  const run189Login = async () => {
    setC189Busy(true);
    try {
      const r = await cloud189Login({
        username: String(values.username ?? ""),
        password: String(values.password ?? ""),
        validate_code: c189VCode,
        state: c189State,
      });
      if (r.need_captcha && r.captcha_image) {
        setC189State(r.state);
        setC189Captcha(r.captcha_image);
        setC189VCode("");
        message.info(t('需要图片验证码，请输入图中字符'));
        return;
      }
      if (r.session) {
        setValues((prev) => ({
          ...prev,
          access_token: r.session!.access_token,
          refresh_token: r.session!.refresh_token,
        }));
        message.success(
          r.session.login_name
            ? t('登录成功，会话已填入（{n}）', { n: r.session.login_name })
            : t('登录成功，会话已填入'),
        );
        resetC189();
      }
    } catch (e) {
      // a consumed captcha invalidates the flow — restart cleanly
      resetC189();
      message.error(e instanceof Error ? e.message : t('登录失败'));
    } finally {
      setC189Busy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `编辑存储 · ${editStorage!.mount_path}` : t('添加存储')}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('修改配置后保存，存储会以新配置重新挂载。')
              : t('选择驱动并填写挂载配置；具体字段由后端驱动定义。')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Form>
            <div className="grid gap-4">
              {/* driver picker — locked in edit mode (changing the driver
                  of an existing storage would invalidate its addition) */}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">{t('驱动')}</label>
                {isEdit ? (
                  <div className="flex h-8 items-center rounded-md border border-border bg-muted/40 px-2.5 font-mono text-xs">
                    {driverName}
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {t('（编辑时不可更换）')}
                    </span>
                  </div>
                ) : (
                  <Command
                    shouldFilter={false}
                    className="overflow-hidden rounded-md border border-border bg-background"
                  >
                    <CommandInput
                      value={driverSearch}
                      onValueChange={(v) => {
                        setDriverSearch(v);
                        setDriverListOpen(true);
                      }}
                      placeholder={t('输入驱动名称筛选，如 123 / local / webdav…')}
                    />
                    {driverListOpen && filteredDrivers.length > 0 && (
                      <CommandList className="max-h-56">
                        <CommandEmpty>{t('没有匹配的驱动')}</CommandEmpty>
                        {filteredDrivers.map((n) => (
                          <CommandItem
                            key={n}
                            value={n}
                            onSelect={() => {
                              setDriverName(n);
                              setValues({});
                              setDriverSearch(n);
                              setDriverListOpen(false);
                            }}
                            className={
                              driverName === n
                                ? "bg-accent/50 text-accent-foreground"
                                : undefined
                            }
                          >
                            {n}
                          </CommandItem>
                        ))}
                      </CommandList>
                    )}
                  </Command>
                )}
                {driverName && (
                  <p className="text-xs text-muted-foreground">
                    {t('已选择：')}<span className="font-mono">{driverName}</span>
                  </p>
                )}
              </div>

              {/* 123 Open: OAuth helper */}
              {driverName === "123 Open" && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-2 text-xs font-medium">
                    {t('OAuth 授权获取 Token')}
                  </div>
                  <ol className="mb-2 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                    <li>
                      点击{" "}
                      <a
                        className="text-primary underline"
                        href={oauthInfo.data?.auth_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('前往 123 云盘授权页')}
                      </a>{" "}
                      并登录授权
                    </li>
                    <li>
                      {t('授权后浏览器会跳转到回调地址（可能显示错误页，忽略即可），从')}
                      <span className="mx-1 font-mono">{t('地址栏')}</span>
                      {t('复制')} <span className="font-mono">code=</span> {t('参数的值')}
                    </li>
                    <li>{t('粘贴到下面，点击“换取 Token”自动填入')}</li>
                  </ol>
                  <div className="flex gap-2">
                    <Input
                      className="h-7 font-mono text-xs"
                      placeholder={t('粘贴授权 code…')}
                      value={oauthCode}
                      onChange={(e) => setOauthCode(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={oauthBusy}
                      onClick={exchangeToken}
                    >
                      {oauthBusy ? t('换取中…') : t('换取 Token')}
                    </Button>
                  </div>
                </div>
              )}

              {/* 189CloudPC: interactive login helper */}
              {driverName === "189CloudPC" && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-1 text-xs font-medium">
                    {t('登录助手（验证账号并自动填入会话）')}
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t('先在下方填写天翼云盘账号密码，再点击登录；需要验证码时会显示图片，输入后提交。成功后自动填入 access_token / refresh_token。')}
                  </p>
                  {c189Captcha && (
                    <div className="mb-2 flex items-center gap-2">
                      <img
                        src={`data:image/png;base64,${c189Captcha}`}
                        className="h-10 rounded border border-border"
                        alt="captcha"
                      />
                      <Input
                        className="h-7 w-32 font-mono text-xs"
                        placeholder={t('验证码')}
                        value={c189VCode}
                        onChange={(e) => setC189VCode(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && run189Login()}
                      />
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      c189Busy ||
                      (!c189Captcha &&
                        (!String(values.username ?? "") ||
                          !String(values.password ?? "")))
                    }
                    onClick={run189Login}
                  >
                    {c189Busy
                      ? t('登录中…')
                      : c189Captcha
                        ? t('提交验证码')
                        : t('登录并填入会话')}
                  </Button>
                </div>
              )}

              {/* common fields (mount_path, order, ...) */}
              {commonFields.map((f) => (
                <div key={f.name} className="grid gap-1.5">
                  <label className="text-sm font-medium">
                    {t(driverFieldLabel(f.name))}
                    {f.required && (
                      <span className="ml-1 text-destructive">*</span>
                    )}
                  </label>
                  <SchemaField
                    item={f}
                    value={values[f.name]}
                    onChange={(v) =>
                      setValues((prev) => ({ ...prev, [f.name]: v }))
                    }
                  />
                  {f.help && (
                    <p className="text-xs text-muted-foreground">{f.help}</p>
                  )}
                </div>
              ))}

              {/* driver-specific fields */}
              {extraFields.length > 0 && (
                <div className="my-1 border-t border-border" />
              )}
              {extraFields.map((f) => (
                <div key={f.name} className="grid gap-1.5">
                  <label className="text-sm font-medium">{t(driverFieldLabel(f.name))}</label>
                  <SchemaField
                    item={f}
                    value={values[f.name]}
                    onChange={(v) =>
                      setValues((prev) => ({ ...prev, [f.name]: v }))
                    }
                  />
                  {f.help && (
                    <p className="text-xs text-muted-foreground">{f.help}</p>
                  )}
                </div>
              ))}
            </div>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button
            disabled={!driverName || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending
              ? isEdit
                ? t('保存中…')
                : t('添加中…')
              : isEdit
                ? t('保存')
                : t('添加')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
