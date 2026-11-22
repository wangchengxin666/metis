import { Briefcase, Edit3, Sparkles, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../../components/ui'
import { useI18n } from '../../lib/i18nContext'
import type { OverviewData, TemplateItem } from '../../types'

export interface TemplatesTabProps {
  templates: TemplateItem[]
  overview: OverviewData | null
  onProvisionWithTemplate: (tplKey: string) => void
  onEditTemplate: (tpl: TemplateItem) => void
  onDeleteTemplate: (tpl: TemplateItem) => void
}

export function TemplatesTab({
  templates,
  overview,
  onProvisionWithTemplate,
  onEditTemplate,
  onDeleteTemplate,
}: TemplatesTabProps) {
  const { t } = useI18n()
  return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <Card key={tpl.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{tpl.name}</CardTitle>
                    <Badge variant="secondary" className="font-mono">
                      {tpl.key}
                    </Badge>
                    {tpl.role_title && (
                      <Badge
                        variant="outline"
                        className="border-indigo-500/40 text-indigo-300"
                      >
                        <Briefcase className="h-3 w-3 mr-1" />
                        {tpl.role_title}
                      </Badge>
                    )}
                    {tpl.role_sop && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-emerald-300"
                      >
                        {t('admin.templates.sopBadge')}
                      </Badge>
                    )}
                  </div>
                  {(tpl.role_description || tpl.description) && (
                    <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                      {tpl.role_description || tpl.description}
                    </p>
                  )}
                </CardHeader>

                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2.5 rounded-[var(--brand-radius-md)] border border-zinc-800/80 bg-zinc-950/60 p-3.5 text-xs">
                    <div>
                      <span className="text-zinc-500 block">{t('admin.templates.imageLabel')}</span>
                      <span className="font-mono text-zinc-200 mt-0.5 block">
                        {tpl.image_repo}:{tpl.image_tag}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">{t('admin.templates.quotaLabel')}</span>
                      <span className="font-mono text-zinc-200 mt-0.5 block">
                        {tpl.default_cpu_limit} vCPU · {tpl.default_memory_limit}
                      </span>
                    </div>
                    <div className="col-span-2 pt-1.5 border-t border-zinc-800/60">
                      <span className="text-zinc-500 block">
                        {t('admin.templates.pluginsLabel')}
                      </span>
                      <span className="font-mono text-zinc-300 mt-0.5 block">
                        {tpl.auto_install_plugins || t('admin.templates.pluginsNone')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => onProvisionWithTemplate(tpl.key)}
                    >
                      <Sparkles className="h-4 w-4" />
                      {t('admin.templates.provisionBtn')}
                    </Button>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEditTemplate(tpl)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {t('admin.templates.editBtn')}
                      </Button>
                      {!tpl.is_builtin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="hover:text-rose-400"
                          onClick={() => onDeleteTemplate(tpl)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {overview && overview.local_images.length > 0 && (
            <details className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4 text-xs">
              <summary className="cursor-pointer font-medium text-zinc-300 select-none">
                {t('admin.templates.localImagesToggle', { count: overview.local_images.length })}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {overview.local_images.map((img) => (
                  <div
                    key={img.full_name}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                  >
                    <span className="font-mono font-medium text-zinc-200 truncate">{img.full_name}</span>
                    <Badge variant="outline">{img.size_mb} MB</Badge>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

  )
}
