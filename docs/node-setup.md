# Настройка VPN-ноды (VLESS + Reality)

Каждая нода — это VPS с Xray и панелью управления. Через API панели дашборд создаёт для каждого устройства отдельного клиента со сроком действия.

Автоматический скрипт установки будет добавлен в `infra/node`. Пока ноду можно поднять вручную через 3x-ui.

## 1. VPS

- Ubuntu 22.04/24.04, от 1 vCPU / 1 GB RAM.
- Выбирайте провайдера и локацию с хорошей связностью до ваших пользователей.
- Откройте порт 443/tcp (для VLESS) и порт панели (например 2053/tcp). Порт панели лучше открыть только для IP сервера с дашбордом.

## 2. Установка 3x-ui

```bash
bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
```

Установщик выдаст URL панели (с секретным путём), логин и пароль. Сохраните их.

## 3. Inbound VLESS + Reality

В панели: **Inbounds → Add Inbound**:

- Protocol: `vless`, Port: `443`
- Transmission: `TCP (RAW)`
- Security: `Reality`
- uTLS: `chrome`
- Dest / SNI: крупный сайт с TLS 1.3 и HTTP/2, доступный из вашей страны, например `www.microsoft.com:443` / `www.microsoft.com`
- Нажмите **Get New Cert**: сгенерируются Private/Public key. Добавьте Short ID.
- У клиента по умолчанию поставьте Flow `xtls-rprx-vision`.

После сохранения запомните **ID inbound** (номер в списке).

## 4. Добавление в дашборд

**Серверы → Добавить сервер**:

| Поле | Значение |
| --- | --- |
| IP / домен, порт | адрес VPS, `443` |
| Public key (pbk) | Public key из настроек Reality |
| Short ID | Short ID из настроек Reality |
| SNI | тот же, что в inbound |
| Тип панели | `3x-ui` |
| URL панели | `https://IP:2053/<секретный-путь>` |
| Логин / пароль | от панели |
| Inbound | ID inbound из шага 3 |

Нажмите **Тест**: дашборд залогинится в панель и проверит доступность порта 443.

## Marzban

Тип панели `Marzban`, URL — адрес панели без `/dashboard`, Inbound — **tag** VLESS Reality inbound из конфига Xray (например `VLESS TCP REALITY`).
