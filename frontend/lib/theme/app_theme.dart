import 'package:flutter/material.dart';

enum TimePhase { am, pm, evening, night }

TimePhase currentPhase() {
  final hour = DateTime.now().hour;
  if (hour >= 6 && hour < 12) return TimePhase.am;
  if (hour >= 12 && hour < 18) return TimePhase.pm;
  if (hour >= 18 && hour < 22) return TimePhase.evening;
  return TimePhase.night;
}

/// AM/PM/저녁/밤 별로 배경·강조색·텍스트색이 자동 전환
class OnStepTheme {
  static const _amBg = Color(0xFFFFF8F0);       // 따뜻한 크림
  static const _amPrimary = Color(0xFFFF8C42);   // 선라이즈 오렌지
  static const _amSurface = Color(0xFFFFEDD5);

  static const _pmBg = Color(0xFFF0F4FF);        // 맑은 하늘
  static const _pmPrimary = Color(0xFF3D6FFF);   // 포커스 블루
  static const _pmSurface = Color(0xFFE0E9FF);

  static const _eveningBg = Color(0xFF1A1A2E);   // 딥 네이비
  static const _eveningPrimary = Color(0xFFE94F6B); // 이브닝 로즈
  static const _eveningSurface = Color(0xFF2D2D4A);

  static const _nightBg = Color(0xFF0D0D1A);     // 미드나잇
  static const _nightPrimary = Color(0xFF7B68EE); // 라벤더 퍼플
  static const _nightSurface = Color(0xFF1A1A2E);

  static ThemeData of(TimePhase phase) {
    switch (phase) {
      case TimePhase.am:
        return _build(
          brightness: Brightness.light,
          bg: _amBg,
          primary: _amPrimary,
          surface: _amSurface,
        );
      case TimePhase.pm:
        return _build(
          brightness: Brightness.light,
          bg: _pmBg,
          primary: _pmPrimary,
          surface: _pmSurface,
        );
      case TimePhase.evening:
        return _build(
          brightness: Brightness.dark,
          bg: _eveningBg,
          primary: _eveningPrimary,
          surface: _eveningSurface,
        );
      case TimePhase.night:
        return _build(
          brightness: Brightness.dark,
          bg: _nightBg,
          primary: _nightPrimary,
          surface: _nightSurface,
        );
    }
  }

  static ThemeData _build({
    required Brightness brightness,
    required Color bg,
    required Color primary,
    required Color surface,
  }) {
    final isDark = brightness == Brightness.dark;
    final onBg = isDark ? Colors.white : const Color(0xFF1A1A1A);
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: bg,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: Colors.white,
        secondary: primary.withOpacity(0.7),
        onSecondary: Colors.white,
        surface: surface,
        onSurface: onBg,
        error: const Color(0xFFE74C3C),
        onError: Colors.white,
      ),
      cardTheme: CardTheme(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
      textTheme: TextTheme(
        displayLarge: TextStyle(
          fontSize: 32, fontWeight: FontWeight.w800, color: onBg, height: 1.2,
        ),
        titleLarge: TextStyle(
          fontSize: 20, fontWeight: FontWeight.w700, color: onBg,
        ),
        bodyMedium: TextStyle(fontSize: 15, color: onBg.withOpacity(0.8)),
        labelLarge: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    );
  }
}
