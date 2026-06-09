plugins {
    id("com.android.application")
    // Kotlin Android plugin — REQUIRED so the `kotlin { compilerOptions { … } }`
    // block below resolves. It is declared `apply false` in settings.gradle.kts and
    // applied here; without it the build fails with "Unresolved reference
    // 'compilerOptions'/'jvmTarget'" under AGP 9 / Kotlin 2.3. Must come BEFORE the
    // Flutter Gradle plugin (per the line below).
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "top.ruletka.ruletka"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "top.ruletka.ruletka"
        // flutter_webrtc + flutter_secure_storage floor; falls back to the
        // Flutter default when that is higher.
        minSdk = maxOf(23, flutter.minSdkVersion)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
