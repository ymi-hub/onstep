import 'package:flutter/material.dart';
import 'theme/app_theme.dart';
import 'screens/home_screen.dart';
import 'screens/assets_screen.dart';

void main() => runApp(const OnStepApp());

class OnStepApp extends StatefulWidget {
  const OnStepApp({super.key});

  @override
  State<OnStepApp> createState() => _OnStepAppState();
}

class _OnStepAppState extends State<OnStepApp> {
  // 1분마다 시간대 체크 → 테마 자동 전환
  late TimePhase _phase;

  @override
  void initState() {
    super.initState();
    _phase = currentPhase();
    _schedulePhaseCheck();
  }

  void _schedulePhaseCheck() {
    Future.delayed(const Duration(minutes: 1), () {
      if (!mounted) return;
      final next = currentPhase();
      if (next != _phase) setState(() => _phase = next);
      _schedulePhaseCheck();
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedTheme(
      data: OnStepTheme.of(_phase),
      duration: const Duration(milliseconds: 800),
      curve: Curves.easeInOut,
      child: Builder(
        builder: (ctx) => MaterialApp(
          title: 'OnStep',
          theme: OnStepTheme.of(_phase),
          debugShowCheckedModeBanner: false,
          home: const _Shell(),
        ),
      ),
    );
  }
}

class _Shell extends StatefulWidget {
  const _Shell();

  @override
  State<_Shell> createState() => _ShellState();
}

class _ShellState extends State<_Shell> {
  int _idx = 0;

  final _screens = const [
    HomeScreen(),
    AssetsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return _screens[_idx];
  }
}
