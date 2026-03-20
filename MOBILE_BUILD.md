# 📱 Сборка мобильных приложений Каспер

Приложение использует **Capacitor** — официальный инструмент для упаковки веб-приложений в нативные Android и iOS.

---

## ⚙️ Требования

| Инструмент | Версия | Для чего |
|-----------|--------|---------|
| Node.js | 18+ | Сборка проекта |
| Java JDK | 17 | Android |
| Android Studio | Hedgehog+ | Android |
| Xcode | 15+ | iOS (только macOS) |
| CocoaPods | 1.14+ | iOS зависимости |

---

## 🚀 Первоначальная настройка

### 1. Скачать код (через GitHub интеграцию poehali.dev)

```bash
git clone <ваш-репозиторий>
cd <папка-проекта>
```

### 2. Установить зависимости

```bash
npm install
```

### 3. Установить Capacitor CLI и плагины

```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android @capacitor/ios
npm install @capacitor/app @capacitor/haptics @capacitor/keyboard
npm install @capacitor/status-bar @capacitor/splash-screen
npm install @capacitor/push-notifications @capacitor/camera
npm install @capacitor/filesystem @capacitor/contacts
```

### 4. Собрать веб-версию

```bash
npm run build
```

---

## 🤖 Android (Google Play / RuStore)

### Шаг 1 — Добавить Android платформу

```bash
npx cap add android
```

### Шаг 2 — Синхронизировать файлы

```bash
npx cap sync android
```

### Шаг 3 — Открыть в Android Studio

```bash
npx cap open android
```

### Шаг 4 — Подпись APK для публикации

В файле `android/app/build.gradle` раскомментируй `signingConfigs.release` и заполни:

```bash
# Создать keystore (один раз):
keytool -genkey -v -keystore kasper-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias kasper
```

Заполни в build.gradle:
```gradle
storeFile file("kasper-release.jks")
storePassword "ВАШ_ПАРОЛЬ"
keyAlias "kasper"
keyPassword "ВАШ_ПАРОЛЬ"
```

### Шаг 5 — Сборка релизного APK / AAB

В Android Studio:
- **Build → Generate Signed Bundle/APK**
- Выбрать **Android App Bundle (.aab)** — для Google Play
- Выбрать **APK** — для RuStore и прямой установки

Или через терминал:
```bash
cd android
./gradlew bundleRelease   # AAB для Google Play
./gradlew assembleRelease # APK для RuStore
```

Файлы появятся в:
- `android/app/build/outputs/bundle/release/app-release.aab`
- `android/app/build/outputs/apk/release/app-release.apk`

---

## 🍎 iOS (App Store)

> ⚠️ Требует macOS + Xcode + аккаунт Apple Developer ($99/год)

### Шаг 1 — Добавить iOS платформу

```bash
npx cap add ios
```

### Шаг 2 — Установить CocoaPods зависимости

```bash
cd ios/App
pod install
cd ../..
```

### Шаг 3 — Синхронизировать файлы

```bash
npx cap sync ios
```

### Шаг 4 — Открыть в Xcode

```bash
npx cap open ios
```

### Шаг 5 — Настройка в Xcode

1. Открой `App.xcworkspace` (не .xcodeproj!)
2. Выбери Target **App** → **Signing & Capabilities**
3. Укажи свой **Team** (Apple Developer аккаунт)
4. **Bundle Identifier**: `dev.poehali.kasper`
5. Включи **Push Notifications** capability
6. Включи **Background Modes** → Remote notifications

### Шаг 6 — Архивация и публикация

1. Product → **Archive**
2. В Organizer → **Distribute App** → App Store Connect
3. Загрузить в App Store Connect → TestFlight → Review

---

## 🛒 Публикация в магазинах

### Google Play

1. Зарегистрировать аккаунт: https://play.google.com/console ($25)
2. Создать новое приложение
3. Заполнить: описание, скриншоты, иконка (512×512 PNG)
4. Загрузить `.aab` файл
5. Пройти модерацию (1-3 дня)

### RuStore

1. Зарегистрировать аккаунт: https://dev.rustore.ru (бесплатно)
2. Создать приложение, заполнить карточку
3. Загрузить `.apk` файл
4. Модерация 1-2 дня

### App Store

1. Аккаунт: https://developer.apple.com ($99/год)
2. Создать запись в App Store Connect
3. Заполнить метаданные (описание на русском, скриншоты для всех размеров)
4. Загрузить через Xcode Organizer
5. Модерация 1-7 дней

---

## 🔄 Обновление приложения

При изменении кода достаточно:

```bash
npm run build       # пересобрать веб
npx cap sync        # синхронизировать с нативными проектами
```

После этого пересобрать APK/IPA через Android Studio / Xcode.

---

## 📋 Иконки и сплэш-экраны

Для генерации всех размеров иконок используй:

```bash
npm install @capacitor/assets --save-dev
npx @capacitor/assets generate --iconBackgroundColor '#071426' --splashBackgroundColor '#071426'
```

Положи исходники в папку `assets/`:
- `assets/icon.png` — 1024×1024px PNG (иконка)
- `assets/splash.png` — 2732×2732px PNG (сплэш-экран)

---

## ❓ Частые проблемы

**Ошибка `SDK location not found`** (Android):
```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
```

**Ошибка CocoaPods** (iOS):
```bash
sudo gem install cocoapods
cd ios/App && pod install --repo-update
```

**Белый экран при запуске** — убедись что `webDir: "dist"` в `capacitor.config.ts` и папка `dist/` существует после `npm run build`.
