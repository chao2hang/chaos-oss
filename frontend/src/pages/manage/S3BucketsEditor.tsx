import { useMemo } from 'react'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@chaos_team/chaos-ui'
import { PlusIcon, Trash2Icon, FolderPlusIcon } from 'lucide-react'
import { useI18n } from '../../i18n'

/** Mirror of server/s3/utils.go Bucket (v1 schema). */
export interface S3Bucket {
  name: string
  /** legacy single path, still accepted by the backend */
  path?: string
  paths?: string[]
  policy?: string // "any" | "all"
}

function parseBuckets(raw: string): S3Bucket[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? (v as S3Bucket[]) : []
  } catch {
    return []
  }
}

function serializeBuckets(buckets: S3Bucket[]): string {
  return JSON.stringify(buckets)
}

/**
 * Structured editor for the s3_buckets setting — the S3 multi-path
 * replication config. Each bucket fans out to one or more storage paths;
 * policy "any" succeeds when any path accepts the write (failures are
 * retried in the background), "all" requires every path to succeed.
 */
export default function S3BucketsEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useI18n()
  const buckets = useMemo(() => parseBuckets(value), [value])

  const update = (next: S3Bucket[]) => onChange(serializeBuckets(next))

  const updateBucket = (idx: number, patch: Partial<S3Bucket>) => {
    update(buckets.map((b, i) => (i === idx ? { ...b, ...patch } : b)))
  }

  const effectivePaths = (b: S3Bucket): string[] =>
    b.paths && b.paths.length > 0 ? b.paths : b.path ? [b.path] : []

  const setPaths = (idx: number, paths: string[]) => {
    updateBucket(idx, { paths, path: undefined })
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-medium">{t('S3 桶（多路径复制）')}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('每个 S3 桶可映射多个存储路径：上传并发写到所有路径；策略 any = 任一路径成功即返回（其余后台重试），all = 全部成功才算成功。')}
        </p>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {buckets.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {t('还没有配置任何 S3 桶')}
          </p>
        )}

        {buckets.map((bucket, idx) => (
          <div key={idx} className="rounded-md border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              <Input
                className="h-7 font-mono text-xs"
                placeholder={t('桶名称（S3 客户端使用的 bucket）')}
                value={bucket.name}
                onChange={(e) => updateBucket(idx, { name: e.target.value })}
              />
              <Select
                value={bucket.policy || 'any'}
                onValueChange={(v) => updateBucket(idx, { policy: v })}
              >
                <SelectTrigger className="h-7 w-28 shrink-0 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('any · 任一成功')}</SelectItem>
                  <SelectItem value="all">{t('all · 全部成功')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                title={t('删除桶')}
                onClick={() => update(buckets.filter((_, i) => i !== idx))}
              >
                <Trash2Icon className="h-4 w-4 text-destructive" />
              </Button>
            </div>

            <div className="mt-2 flex flex-col gap-1.5">
              {effectivePaths(bucket).map((p, pi) => (
                <div key={pi} className="flex items-center gap-2">
                  <Input
                    className="h-7 font-mono text-xs"
                    placeholder={t('存储路径，如 /123/backup')}
                    value={p}
                    onChange={(e) => {
                      const paths = [...effectivePaths(bucket)]
                      paths[pi] = e.target.value
                      setPaths(idx, paths)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('删除路径')}
                    onClick={() =>
                      setPaths(
                        idx,
                        effectivePaths(bucket).filter((_, i) => i !== pi),
                      )
                    }
                  >
                    <Trash2Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-xs text-muted-foreground"
                onClick={() => setPaths(idx, [...effectivePaths(bucket), ''])}
              >
                <FolderPlusIcon className="mr-1 h-3.5 w-3.5" />
                {t('添加路径')}
              </Button>
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            update([...buckets, { name: '', paths: [''], policy: 'any' }])
          }
        >
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('添加桶')}
        </Button>
      </div>
    </div>
  )
}
