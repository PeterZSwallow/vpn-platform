import { headers } from "next/headers"
import { getSettings } from "@/lib/settings"
import { saveAppSettings } from "./actions"

export const dynamic = "force-dynamic"

function Input({
	name,
	label,
	defaultValue,
	type = "text",
	placeholder,
	hint,
}: {
	name: string
	label: string
	defaultValue?: string | number
	type?: string
	placeholder?: string
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
				defaultValue={defaultValue}
				placeholder={placeholder}
			/>
			{hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
		</div>
	)
}

function Url({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="label">{label}</div>
			<code className="block break-all rounded-lg bg-zinc-950 px-3 py-2 text-xs text-emerald-300">
				{value}
			</code>
		</div>
	)
}

const mask = (s: string) => (s ? `задан (…${s.slice(-4)})` : "не задан")

export default async function SettingsPage() {
	const s = await getSettings()
	const h = await headers()
	const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`

	return (
		<form action={saveAppSettings} className="space-y-6">
			<div className="flex items-center gap-3">
				<h1 className="text-xl font-semibold">Настройки</h1>
				<button className="btn ml-auto" type="submit">
					Сохранить
				</button>
			</div>

			<section className="card space-y-4">
				<h2 className="font-medium">Провайдер подписок</h2>
				<p className="text-sm text-zinc-400">
					Приложение читает этот переключатель при запуске и использует
					соответствующий SDK. Вебхуки обоих провайдеров принимаются всегда,
					поэтому уже оформленные подписки продолжают работать после
					переключения.
				</p>
				<div className="flex flex-wrap gap-3">
					{(["revenuecat", "storekit"] as const).map((p) => (
						<label
							key={p}
							className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 px-4 py-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-950/40"
						>
							<input
								type="radio"
								name="billingProvider"
								value={p}
								defaultChecked={s.billingProvider === p}
							/>
							<span className="text-sm font-medium">
								{p === "revenuecat" ? "RevenueCat" : "StoreKit 2 (напрямую)"}
							</span>
						</label>
					))}
				</div>
			</section>

			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">RevenueCat</h2>
				<Input
					name="rcIosApiKey"
					label="Public iOS SDK key"
					defaultValue={s.revenuecat.iosApiKey}
					placeholder="appl_..."
				/>
				<Input
					name="rcEntitlementId"
					label="Entitlement ID"
					defaultValue={s.revenuecat.entitlementId}
				/>
				<Input
					name="rcOfferingId"
					label="Offering ID"
					defaultValue={s.revenuecat.offeringId}
				/>
				<Input
					name="rcSecretApiKey"
					label="Secret API key (v1)"
					type="password"
					placeholder={mask(s.revenuecat.secretApiKey)}
					hint="Нужен для проверки статуса подписки на сервере"
				/>
				<Input
					name="rcWebhookAuth"
					label="Webhook Authorization header"
					type="password"
					placeholder={mask(s.revenuecat.webhookAuth)}
					hint="То же значение укажите в RevenueCat → Integrations → Webhooks"
				/>
				<Url label="Webhook URL" value={`${origin}/api/webhooks/revenuecat`} />
			</section>

			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">StoreKit 2</h2>
				<Input
					name="skBundleId"
					label="Bundle ID"
					defaultValue={s.storekit.bundleId}
					placeholder="com.example.vpn"
				/>
				<Input
					name="skProductIds"
					label="Product IDs (через запятую)"
					defaultValue={s.storekit.productIds.join(", ")}
					placeholder="vpn.premium.month, vpn.premium.year"
				/>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="skAllowSandbox"
						defaultChecked={s.storekit.allowSandbox}
					/>
					Принимать Sandbox-покупки (TestFlight)
				</label>
				<Url
					label="App Store Server Notifications V2 URL"
					value={`${origin}/api/webhooks/appstore`}
				/>
			</section>

			<section className="card grid gap-4 sm:grid-cols-2">
				<h2 className="font-medium sm:col-span-2">Реклама (AdMob)</h2>
				<label className="flex items-center gap-2 text-sm sm:col-span-2">
					<input
						type="checkbox"
						name="adsEnabled"
						defaultChecked={s.ads.enabled}
					/>
					Бесплатные пользователи смотрят rewarded-рекламу, чтобы подключиться
				</label>
				<Input
					name="admobAppId"
					label="AdMob App ID"
					defaultValue={s.ads.admobAppId}
					placeholder="ca-app-pub-...~..."
					hint="Его же нужно прописать в Info.plist приложения"
				/>
				<Input
					name="rewardedUnitId"
					label="Rewarded unit ID"
					defaultValue={s.ads.rewardedUnitId}
				/>
				<Input
					name="interstitialUnitId"
					label="Interstitial unit ID"
					defaultValue={s.ads.interstitialUnitId}
				/>
				<Input
					name="bannerUnitId"
					label="Banner unit ID"
					defaultValue={s.ads.bannerUnitId}
				/>
				<Input
					name="rewardMinutes"
					label="Минут VPN за один ролик"
					type="number"
					defaultValue={s.ads.rewardMinutes}
				/>
				<Input
					name="maxFreeMinutes"
					label="Максимум накопленных минут"
					type="number"
					defaultValue={s.ads.maxFreeMinutes}
				/>
				<Input
					name="interstitialEveryConnects"
					label="Interstitial каждые N подключений (0 = выкл)"
					type="number"
					defaultValue={s.ads.interstitialEveryConnects}
				/>
				<Url
					label="Server-side verification callback URL"
					value={`${origin}/api/v1/ads/admob-ssv`}
				/>
			</section>
		</form>
	)
}
