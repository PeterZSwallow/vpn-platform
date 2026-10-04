# iOS-приложение

SwiftUI-приложение и расширение Packet Tunnel. Внутри работает **Xray-core** через [libXray](https://github.com/XTLS/libXray): встроенный TUN Xray читает пакеты прямо из туннеля iOS. Конфиг подключения целиком выдаёт дашборд (`/api/v1/connect`).

```
App/            приложение: экраны, логика подключения, покупки, реклама
PacketTunnel/   расширение NetworkExtension: запускает Xray на utun
Shared/         общий код (профиль туннеля в App Group)
Config/         xcconfig: bundle id, URL дашборда, AdMob App ID
scripts/        сборка LibXray.xcframework
project.yml     описание проекта для XcodeGen
```

## Что нужно

- Mac с Xcode 16+, [Homebrew](https://brew.sh): `brew install xcodegen go`
- Платный Apple Developer аккаунт. Network Extension недоступен на бесплатном. Для публикации VPN в App Store Apple требует аккаунт **организации**.

## Сборка

```bash
cd apps/ios
cp Config/Local.xcconfig.example Config/Local.xcconfig   # заполните значения
./scripts/build-libxray.sh                               # ~5–10 минут, один раз
xcodegen generate
open VPN.xcodeproj
```

В `Config/Local.xcconfig`:

| Ключ | Что это |
| --- | --- |
| `APP_BUNDLE_ID` | Bundle ID приложения; у расширения будет `<id>.tunnel` |
| `APP_GROUP_ID` | По умолчанию `group.<bundle id>` |
| `DEVELOPMENT_TEAM` | Team ID из developer.apple.com |
| `API_BASE_URL` | Адрес дашборда, `https:/$()/admin.example.com` (`$()` нужно из-за синтаксиса xcconfig) |
| `ADMOB_APP_ID` | App ID из AdMob (по умолчанию тестовый от Google) |

В [developer.apple.com](https://developer.apple.com/account/resources/identifiers) для **обоих** Bundle ID (`<id>` и `<id>.tunnel`) включите **Network Extensions** и **App Groups** и добавьте в них одну и ту же группу `APP_GROUP_ID`. При автоматической подписи Xcode обычно делает это сам.

VPN нельзя проверить в симуляторе. Запускайте на iPhone.

## Как работает подключение

1. При первом запуске создаётся `installId` (UUID в Keychain, переживает переустановку). Он же служит `app_user_id` в RevenueCat, `appAccountToken` в StoreKit и `user_id` в проверке наград AdMob.
2. `GET /api/v1/config` сообщает, какой биллинг включён в дашборде (RevenueCat или StoreKit 2) и какие рекламные блоки показывать.
3. Бесплатный пользователь смотрит rewarded-ролик. AdMob сообщает о награде дашборду, приложение ждёт, пока время будет начислено.
4. `POST /api/v1/connect` возвращает личный конфиг Xray. Приложение кладёт его в App Group и запускает туннель. Расширение находит дескриптор utun, передаёт его Xray через `env["xray.tun.fd"]` и вызывает `LibXrayInvoke` (`runXray`).
5. После подключения приложение проверяет, что трафик идёт. Если не идёт, а использовался личный IPv6, оно запрашивает новый адрес (`rotateIpv6`) и переподключается один раз.
6. Туннель сам отключается в момент `expiresAt`. Нода к тому же отключает клиента на своей стороне.

## Настройка сервисов

**RevenueCat** (если выбран в дашборде): создайте проект, привяжите App Store app, заведите entitlement (`premium`) и offering (`default`) с пакетами. Ключи и вебхук настраиваются в **Дашборд → Настройки**.

**StoreKit 2** (если выбран): создайте подписки в App Store Connect, впишите их Product ID в дашборде. В App Store Connect укажите URL App Store Server Notifications V2 из дашборда.

**AdMob**: создайте приложение и блоки Rewarded, Interstitial и Banner. ID блоков впишите в дашборде, а App ID — в `ADMOB_APP_ID`. В rewarded-блоке включите Server-side verification с URL из дашборда. В отладочной сборке, пока блоки не заданы, показывается тестовая реклама Google. Перед релизом добавьте полный список `SKAdNetworkItems` от Google в `project.yml`.

## Публикация

- **Export compliance:** приложение использует шифрование. В App Store Connect ответьте на вопросы об экспорте (VPN подпадает под стандартное шифрование, но вопросы нужно заполнить).
- **App Review:** для VPN нужна политика конфиденциальности, описание того, какие данные собираются, и аккаунт организации. Демо-доступ для ревьюера можно выдать в дашборде (**Пользователи → + дни**).
- **Лицензии:** Xray-core (MPL-2.0) и libXray (MIT) допускают закрытое приложение. Укажите их в разделе «Лицензии» приложения или на сайте.

## Проверка сборки в CI

`.github/workflows/ios.yml` собирает приложение для симулятора без подписи при изменениях в `apps/ios`. Задание выполняется на macOS-раннере, а такие минуты GitHub Actions расходуются быстрее обычных.
