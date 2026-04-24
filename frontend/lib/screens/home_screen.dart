import 'package:flutter/material.dart';
import '../models/flow_guide.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  FlowGuideResponse? _guide;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final guide = await apiService.getFlowGuide();
      setState(() { _guide = guide; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final phase = currentPhase();
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _ErrorView(error: _error!, onRetry: _load)
                : _GuideBody(guide: _guide!, phase: phase, theme: theme),
      ),
    );
  }
}

class _GuideBody extends StatelessWidget {
  final FlowGuideResponse guide;
  final TimePhase phase;
  final ThemeData theme;

  const _GuideBody({
    required this.guide,
    required this.phase,
    required this.theme,
  });

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {
        // 부모 _load 호출을 위해 콜백 전달
      },
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        children: [
          _PhaseHeader(guide: guide, theme: theme),
          const SizedBox(height: 32),
          _OneActionCard(guide: guide, theme: theme),
          if (guide.forcedRoutine != null) ...[
            const SizedBox(height: 16),
            _ForcedRoutineBanner(message: guide.forcedRoutine!, theme: theme),
          ],
          const SizedBox(height: 32),
          _BottomNav(theme: theme),
        ],
      ),
    );
  }
}

class _PhaseHeader extends StatelessWidget {
  final FlowGuideResponse guide;
  final ThemeData theme;
  const _PhaseHeader({required this.guide, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          guide.phaseLabel,
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.primary,
            letterSpacing: 3,
          ),
        ),
        const SizedBox(height: 8),
        Text(guide.card.greeting, style: theme.textTheme.displayLarge),
        if (guide.weather != null) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(Icons.thermostat, size: 16, color: theme.colorScheme.primary),
              const SizedBox(width: 4),
              Text(
                '${guide.weather!.temp.toStringAsFixed(0)}°C · '
                '습도 ${guide.weather!.humidity}%',
                style: theme.textTheme.bodyMedium,
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// 딱 하나의 행동 카드 — OnStep 핵심 UI
class _OneActionCard extends StatelessWidget {
  final FlowGuideResponse guide;
  final ThemeData theme;
  const _OneActionCard({required this.guide, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    '지금 할 것 · ${guide.card.durationMinutes}분',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const Spacer(),
                if (guide.card.outfitReady)
                  const Icon(Icons.check_circle, color: Colors.green, size: 20),
              ],
            ),
            const SizedBox(height: 20),
            Text(guide.card.oneAction, style: theme.textTheme.titleLarge),
            const SizedBox(height: 12),
            Text(
              guide.card.actionReason,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {},
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 4),
                  child: Text('시작하기'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 저녁 강제 루틴 배너 — 내일 옷 미준비 시 항상 노출
class _ForcedRoutineBanner extends StatelessWidget {
  final String message;
  final ThemeData theme;
  const _ForcedRoutineBanner({required this.message, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary.withOpacity(0.12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.primary.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.checkroom, color: theme.colorScheme.primary, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Text(message, style: theme.textTheme.bodyMedium),
          ),
          Icon(Icons.arrow_forward_ios, size: 14, color: theme.colorScheme.primary),
        ],
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  final ThemeData theme;
  const _BottomNav({required this.theme});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        _NavBtn(icon: Icons.home_rounded, label: '홈', isActive: true, theme: theme),
        _NavBtn(icon: Icons.checkroom, label: '자산', isActive: false, theme: theme),
        _NavBtn(icon: Icons.bar_chart, label: 'ROI', isActive: false, theme: theme),
        _NavBtn(icon: Icons.settings, label: '설정', isActive: false, theme: theme),
      ],
    );
  }
}

class _NavBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final ThemeData theme;
  const _NavBtn({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.theme,
  });

  @override
  Widget build(BuildContext context) {
    final color = isActive ? theme.colorScheme.primary : theme.colorScheme.onSurface.withOpacity(0.4);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 26),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.wifi_off, size: 48, color: Colors.grey),
          const SizedBox(height: 16),
          const Text('서버에 연결할 수 없어요'),
          const SizedBox(height: 8),
          TextButton(onPressed: onRetry, child: const Text('다시 시도')),
        ],
      ),
    );
  }
}
