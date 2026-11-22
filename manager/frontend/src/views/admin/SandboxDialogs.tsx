import React from 'react'
import { Button, Dialog, Input, Label, Select, Textarea } from '../../components/ui'
import { generatePassword } from '../../lib/format'
import { useI18n } from '../../lib/i18nContext'
import type {
  LlmProfileItem,
  OverviewData,
  RolePresetItem,
  SandboxItem,
  TemplateItem,
  UserItem,
} from '../../types'

export interface ProvisionFormState {
  email: string
  display_name: string
  initial_password: string
  slug: string
  template: string
  role_title: string
  role_description: string
  role_sop: string
  image_repo: string
  image_tag: string
  cpu_limit: string
  memory_limit: string
  llm_profile_id: string
  init_repo_url: string
  auto_install_plugins: string
  init_script: string
  auto_sleep_exempt: boolean
}

export interface TemplateFormState {
  key: string
  name: string
  description: string
  role_title: string
  role_description: string
  role_sop: string
  default_llm_profile_id: string
  image_repo: string
  image_tag: string
  default_cpu_limit: string
  default_memory_limit: string
  auto_install_plugins: string
  init_script: string
  default_env_json: string
}

export interface EditSandboxFormState {
  role_title: string
  role_description: string
  role_sop: string
  cpu_limit: string
  memory_limit: string
  image_repo: string
  image_tag: string
  llm_profile_id: string
  preview_auth_mode: string
  daily_token_limit: string
  auto_sleep_exempt: boolean
}

export function ProvisionSandboxDialog({
  open: createSbxOpen,
  onOpenChange: setCreateSbxOpen,
  form: sbxForm,
  setForm: setSbxForm,
  creating: creatingSbx,
  onSubmit: handleCreateSandbox,
  onApplyTemplate: applyTemplateToSandboxForm,
  users,
  templates,
  llmProfiles,
  effectiveAllowLocalUser,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: ProvisionFormState
  setForm: React.Dispatch<React.SetStateAction<ProvisionFormState>>
  creating: boolean
  onSubmit: (e: React.FormEvent) => void
  onApplyTemplate: (tplKey: string) => void
  users: UserItem[]
  templates: TemplateItem[]
  llmProfiles: LlmProfileItem[]
  effectiveAllowLocalUser: boolean
}) {
  const { t } = useI18n()
  return (
      <Dialog
        open={createSbxOpen}
        onOpenChange={setCreateSbxOpen}
        title={t('dialog.provision.title')}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateSandbox} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.emailLabel')}</Label>
              <Input
                type="email"
                required
                list="existing-users-list"
                placeholder="employee@example.com"
                value={sbxForm.email}
                onChange={(e) => setSbxForm({ ...sbxForm, email: e.target.value })}
              />
              <datalist id="existing-users-list">
                {users.map((u) => (
                  <option key={u.id} value={u.email}>
                    {u.display_name || u.email}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.nameLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.namePlaceholder')}
                value={sbxForm.display_name}
                onChange={(e) => setSbxForm({ ...sbxForm, display_name: e.target.value })}
              />
            </div>

            {effectiveAllowLocalUser && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('dialog.provision.pwLabel')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    minLength={6}
                    placeholder={t('dialog.provision.pwPlaceholder')}
                    value={sbxForm.initial_password}
                    onChange={(e) =>
                      setSbxForm({ ...sbxForm, initial_password: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSbxForm({ ...sbxForm, initial_password: generatePassword() })
                    }
                  >
                    {t('dialog.provision.pwGenBtn')}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.templateLabel')}</Label>
              <Select
                value={sbxForm.template}
                onChange={(e) => applyTemplateToSandboxForm(e.target.value)}
              >
                {templates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.name} ({tpl.key})
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.llmLabel')}</Label>
              <Select
                value={sbxForm.llm_profile_id}
                onChange={(e) => setSbxForm({ ...sbxForm, llm_profile_id: e.target.value })}
              >
                <option value="">{t('dialog.provision.llmNone')}</option>
                {llmProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.roleTitleLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.roleTitlePlaceholder')}
                value={sbxForm.role_title}
                onChange={(e) => setSbxForm({ ...sbxForm, role_title: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.provision.roleDescLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.roleDescPlaceholder')}
                value={sbxForm.role_description}
                onChange={(e) => setSbxForm({ ...sbxForm, role_description: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.provision.roleSopLabel')}</Label>
              <Textarea
                rows={3}
                placeholder={t('dialog.provision.roleSopPlaceholder')}
                value={sbxForm.role_sop}
                onChange={(e) => setSbxForm({ ...sbxForm, role_sop: e.target.value })}
              />
            </div>

            <details className="sm:col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
              <summary className="cursor-pointer font-medium text-zinc-300 select-none">
                {t('dialog.provision.advancedToggle')}
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.slugLabel')}</Label>
                  <Input
                    placeholder={t('dialog.provision.slugPlaceholder')}
                    value={sbxForm.slug}
                    onChange={(e) => setSbxForm({ ...sbxForm, slug: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.pluginsLabel')}</Label>
                  <Input
                    placeholder="file-manager"
                    value={sbxForm.auto_install_plugins}
                    onChange={(e) =>
                      setSbxForm({ ...sbxForm, auto_install_plugins: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.repoLabel')}</Label>
                  <Input
                    value={sbxForm.image_repo}
                    onChange={(e) => setSbxForm({ ...sbxForm, image_repo: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.tagLabel')}</Label>
                  <Input
                    value={sbxForm.image_tag}
                    onChange={(e) => setSbxForm({ ...sbxForm, image_tag: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.cpuLabel')}</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="64"
                    value={sbxForm.cpu_limit}
                    onChange={(e) => setSbxForm({ ...sbxForm, cpu_limit: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>{t('dialog.provision.memLabel')}</Label>
                  <Input
                    value={sbxForm.memory_limit}
                    onChange={(e) => setSbxForm({ ...sbxForm, memory_limit: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('dialog.provision.repoUrlLabel')}</Label>
                  <Input
                    placeholder="https://github.com/org/repo.git"
                    value={sbxForm.init_repo_url}
                    onChange={(e) => setSbxForm({ ...sbxForm, init_repo_url: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('dialog.provision.initScriptLabel')}</Label>
                  <Textarea
                    rows={3}
                    placeholder="#!/usr/bin/env bash"
                    value={sbxForm.init_script}
                    onChange={(e) => setSbxForm({ ...sbxForm, init_script: e.target.value })}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sbxForm.auto_sleep_exempt}
                      onChange={(e) =>
                        setSbxForm({ ...sbxForm, auto_sleep_exempt: e.target.checked })
                      }
                      className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                    />
                    <span>{t('dialog.provision.autoSleepExemptLabel')}</span>
                  </label>
                </div>
              </div>
            </details>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setCreateSbxOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={creatingSbx}>
              {creatingSbx ? t('dialog.provision.submitting') : t('dialog.provision.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

  )
}

export function TemplateEditorDialog({
  open: tplModalOpen,
  onOpenChange: setTplModalOpen,
  editing: editingTpl,
  form: tplForm,
  setForm: setTplForm,
  saving: savingTpl,
  onSubmit: handleSaveTemplate,
  rolePresets,
  overview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: TemplateItem | null
  form: TemplateFormState
  setForm: React.Dispatch<React.SetStateAction<TemplateFormState>>
  saving: boolean
  onSubmit: (e: React.FormEvent) => void
  rolePresets: RolePresetItem[]
  overview: OverviewData | null
}) {
  const { t } = useI18n()
  return (
      <Dialog
        open={tplModalOpen}
        onOpenChange={setTplModalOpen}
        title={
          editingTpl
            ? t('dialog.template.editTitle', { name: editingTpl.name })
            : t('dialog.template.createTitle')
        }
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveTemplate} className="space-y-4 text-xs">
          {!editingTpl && rolePresets.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
              <div className="text-[11px] font-medium text-zinc-400">
                {t('admin.seedPresetsBtn')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rolePresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setTplForm({
                        ...tplForm,
                        key: preset.key,
                        name: preset.name,
                        description: preset.description,
                        role_title: preset.role_title,
                        role_description: preset.role_description,
                        role_sop: preset.role_sop,
                        image_repo: preset.image_repo,
                        image_tag: preset.image_tag,
                        default_cpu_limit: String(preset.default_cpu_limit),
                        default_memory_limit: preset.default_memory_limit,
                        auto_install_plugins: preset.auto_install_plugins,
                      })
                    }
                    className="rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 hover:border-indigo-500/60 hover:text-indigo-300 cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('dialog.template.keyLabel')}</Label>
              <Input
                required
                disabled={!!editingTpl}
                placeholder={t('dialog.template.keyPlaceholder')}
                value={tplForm.key}
                onChange={(e) => setTplForm({ ...tplForm, key: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.nameLabel')}</Label>
              <Input
                required
                placeholder={t('dialog.template.namePlaceholder')}
                value={tplForm.name}
                onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.template.roleTitleLabel')}</Label>
              <Input
                placeholder={t('dialog.template.roleTitlePlaceholder')}
                value={tplForm.role_title}
                onChange={(e) => setTplForm({ ...tplForm, role_title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.roleDescLabel')}</Label>
              <Input
                placeholder={t('dialog.template.roleDescPlaceholder')}
                value={tplForm.role_description}
                onChange={(e) => setTplForm({ ...tplForm, role_description: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.descLabel')}</Label>
              <Input
                placeholder={t('dialog.template.descPlaceholder')}
                value={tplForm.description}
                onChange={(e) => setTplForm({ ...tplForm, description: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.roleSopLabel')}</Label>
              <Textarea
                rows={4}
                placeholder={t('dialog.template.roleSopPlaceholder')}
                value={tplForm.role_sop}
                onChange={(e) => setTplForm({ ...tplForm, role_sop: e.target.value })}
              />
            </div>

            {overview && overview.local_images.length > 0 && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t('dialog.template.localPickLabel')}</Label>
                <Select
                  value={`${tplForm.image_repo}:${tplForm.image_tag}`}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val.includes(':')) {
                      const [r, tag] = val.split(':')
                      setTplForm({ ...tplForm, image_repo: r, image_tag: tag })
                    }
                  }}
                >
                  {overview.local_images.map((img) => (
                    <option key={img.full_name} value={img.full_name}>
                      {img.full_name} ({img.size_mb} MB)
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('dialog.template.repoLabel')}</Label>
              <Input
                required
                value={tplForm.image_repo}
                onChange={(e) => setTplForm({ ...tplForm, image_repo: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.tagLabel')}</Label>
              <Input
                required
                value={tplForm.image_tag}
                onChange={(e) => setTplForm({ ...tplForm, image_tag: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('dialog.template.cpuLabel')}</Label>
              <Input
                type="number"
                step="0.5"
                min="0.5"
                max="64"
                value={tplForm.default_cpu_limit}
                onChange={(e) => setTplForm({ ...tplForm, default_cpu_limit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.template.memLabel')}</Label>
              <Input
                value={tplForm.default_memory_limit}
                onChange={(e) =>
                  setTplForm({ ...tplForm, default_memory_limit: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.pluginsLabel')}</Label>
              <Input
                value={tplForm.auto_install_plugins}
                onChange={(e) =>
                  setTplForm({ ...tplForm, auto_install_plugins: e.target.value })
                }
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.initScriptLabel')}</Label>
              <Textarea
                rows={4}
                placeholder="#!/usr/bin/env bash"
                value={tplForm.init_script}
                onChange={(e) => setTplForm({ ...tplForm, init_script: e.target.value })}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('dialog.template.envJsonLabel')}</Label>
              <Textarea
                rows={2}
                value={tplForm.default_env_json}
                onChange={(e) => setTplForm({ ...tplForm, default_env_json: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setTplModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingTpl}>
              {savingTpl ? t('common.saving') : t('dialog.template.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

  )
}

export function EditSandboxDialog({
  target: editSbx,
  onClose,
  form: editSbxForm,
  setForm: setEditSbxForm,
  saving: savingSbx,
  onSubmit: handleSaveSandboxSpec,
  llmProfiles,
}: {
  target: SandboxItem | null
  onClose: () => void
  form: EditSandboxFormState
  setForm: React.Dispatch<React.SetStateAction<EditSandboxFormState>>
  saving: boolean
  onSubmit: (e: React.FormEvent) => void
  llmProfiles: LlmProfileItem[]
}) {
  const { t } = useI18n()
  const setEditSbx = (_v: null) => onClose()
  return (
      <Dialog
        open={!!editSbx}
        onOpenChange={(o) => !o && setEditSbx(null)}
        title={t('dialog.editSandbox.title', { slug: editSbx?.slug ?? '' })}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSaveSandboxSpec} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.roleTitleLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.roleTitlePlaceholder')}
                value={editSbxForm.role_title}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, role_title: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.provision.roleDescLabel')}</Label>
              <Input
                placeholder={t('dialog.provision.roleDescPlaceholder')}
                value={editSbxForm.role_description}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, role_description: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t('dialog.provision.roleSopLabel')}</Label>
              <Textarea
                rows={3}
                placeholder={t('dialog.provision.roleSopPlaceholder')}
                value={editSbxForm.role_sop}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, role_sop: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.cpuLabel')}</Label>
              <Input
                type="number"
                step="0.5"
                value={editSbxForm.cpu_limit}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, cpu_limit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.memLabel')}</Label>
              <Input
                value={editSbxForm.memory_limit}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, memory_limit: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.repoLabel')}</Label>
              <Input
                value={editSbxForm.image_repo}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, image_repo: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.tagLabel')}</Label>
              <Input
                value={editSbxForm.image_tag}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, image_tag: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t('dialog.editSandbox.llmLabel')}</Label>
              <Select
                value={editSbxForm.llm_profile_id}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, llm_profile_id: e.target.value })
                }
              >
                <option value="">{t('dialog.editSandbox.llmNone')}</option>
                {llmProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.previewAuthLabel')}</Label>
              <Select
                value={editSbxForm.preview_auth_mode}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, preview_auth_mode: e.target.value })
                }
              >
                <option value="public">{t('dialog.editSandbox.previewAuthPublic')}</option>
                <option value="authenticated">
                  {t('dialog.editSandbox.previewAuthAuthenticated')}
                </option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('dialog.editSandbox.dailyTokenLimitLabel')}</Label>
              <Input
                type="number"
                min={0}
                step={10000}
                placeholder="e.g. 500000"
                value={editSbxForm.daily_token_limit}
                onChange={(e) =>
                  setEditSbxForm({ ...editSbxForm, daily_token_limit: e.target.value })
                }
              />
            </div>
            <div className="col-span-2 pt-1">
              <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editSbxForm.auto_sleep_exempt}
                  onChange={(e) =>
                    setEditSbxForm({ ...editSbxForm, auto_sleep_exempt: e.target.checked })
                  }
                  className="rounded border-zinc-700 bg-zinc-900 accent-indigo-500"
                />
                <span>{t('dialog.editSandbox.autoSleepExemptLabel')}</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={() => setEditSbx(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={savingSbx}>
              {savingSbx ? t('dialog.editSandbox.submitting') : t('dialog.editSandbox.submit')}
            </Button>
          </div>
        </form>
      </Dialog>

  )
}
