import type { Server } from "@/db/schema"

function Field({
	name,
	label,
	defaultValue,
	type = "text",
	placeholder,
	required,
	hint,
}: {
	name: string
	label: string
	defaultValue?: string | number | null
	type?: string
	placeholder?: string
	required?: boolean
	hint?: string
}) {
	return (
		<div>
			<label className="label" htmlFor={name}>
				{label}
			</label>
			<input
				className="input"
				id={name}
				name={name}
				type={type}
				defaultValue={defaultValue ?? ""}
				placeholder={placeholder}
				required={required}
			/>
			{hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
		</div>
	)
}

export function ServerForm({
	action,
	server,
	submitLabel,
}: {
	action: (formData: FormData) => Promise<void>
	server?: Server
	submitLabel: string
}) {
	return (
		<form action={action} className="space-y-6">
			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">Основное</h2>
				<Field
					name="name"
					label="Название"
					defaultValue={server?.name}
					placeholder="Нидерланды #1"
					required
				/>
				<div className="grid grid-cols-2 gap-4">
					<Field
						name="countryCode"
						label="Страна (ISO)"
						defaultValue={server?.countryCode}
						placeholder="NL"
						required
					/>
					<Field
						name="city"
						label="Город"
						defaultValue={server?.city}
						placeholder="Amsterdam"
					/>
				</div>
				<Field
					name="host"
					label="IP / домен"
					defaultValue={server?.host}
					placeholder="203.0.113.10"
					required
				/>
				<Field
					name="port"
					label="Порт"
					type="number"
					defaultValue={server?.port ?? 443}
					required
				/>
				<div>
					<label className="label" htmlFor="tier">
						Тариф
					</label>
					<select
						className="input"
						id="tier"
						name="tier"
						defaultValue={server?.tier ?? "free"}
					>
						<option value="free">Бесплатный (с рекламой)</option>
						<option value="premium">Только премиум</option>
					</select>
				</div>
				<Field
					name="sortOrder"
					label="Порядок в списке"
					type="number"
					defaultValue={server?.sortOrder ?? 0}
				/>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="enabled"
						defaultChecked={server?.enabled ?? true}
					/>
					Включён (виден в приложении)
				</label>
			</section>

			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">VLESS + Reality</h2>
				<Field
					name="realityPublicKey"
					label="Public key (pbk)"
					defaultValue={server?.realityPublicKey}
					required
				/>
				<Field
					name="realityShortId"
					label="Short ID (sid)"
					defaultValue={server?.realityShortId}
					placeholder="hex, напр. 6ba85179e30d4fc2"
				/>
				<Field
					name="realitySni"
					label="SNI / dest"
					defaultValue={server?.realitySni}
					placeholder="www.microsoft.com"
					required
				/>
				<Field
					name="fingerprint"
					label="uTLS fingerprint"
					defaultValue={server?.fingerprint ?? "chrome"}
					required
				/>
				<Field
					name="flow"
					label="Flow"
					defaultValue={server?.flow ?? "xtls-rprx-vision"}
				/>
			</section>

			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">Панель управления нодой</h2>
				<div>
					<label className="label" htmlFor="panelType">
						Тип
					</label>
					<select
						className="input"
						id="panelType"
						name="panelType"
						defaultValue={server?.panelType ?? "3x-ui"}
					>
						<option value="3x-ui">3x-ui (личный UUID на устройство)</option>
						<option value="marzban">Marzban (личный UUID на устройство)</option>
						<option value="static">Без панели (один общий UUID)</option>
					</select>
				</div>
				<Field
					name="panelUrl"
					label="URL панели"
					defaultValue={server?.panelUrl}
					placeholder="https://203.0.113.10:2053/secretpath"
					hint="Для 3x-ui включите путь (web base path)"
				/>
				<Field
					name="panelUsername"
					label="Логин панели"
					defaultValue={server?.panelUsername}
				/>
				<Field
					name="panelPassword"
					label="Пароль панели"
					type="password"
					placeholder={server ? "оставьте пустым, чтобы не менять" : ""}
				/>
				<Field
					name="panelInbound"
					label="Inbound"
					defaultValue={server?.panelInbound}
					hint="3x-ui: числовой ID inbound. Marzban: tag inbound (напр. VLESS TCP REALITY)"
				/>
				<Field
					name="staticUuid"
					label="Общий UUID (только «без панели»)"
					defaultValue={server?.staticUuid}
					hint="Без панели доступ нельзя отозвать по окончании подписки"
				/>
			</section>

			<button className="btn" type="submit">
				{submitLabel}
			</button>
		</form>
	)
}
