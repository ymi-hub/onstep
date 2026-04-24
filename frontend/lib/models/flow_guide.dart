class WeatherInfo {
  final double temp;
  final double feelsLike;
  final String condition;
  final int humidity;
  final String city;

  const WeatherInfo({
    required this.temp,
    required this.feelsLike,
    required this.condition,
    required this.humidity,
    required this.city,
  });

  factory WeatherInfo.fromJson(Map<String, dynamic> j) => WeatherInfo(
        temp: (j['temp'] as num).toDouble(),
        feelsLike: (j['feels_like'] as num).toDouble(),
        condition: j['condition'] as String,
        humidity: j['humidity'] as int,
        city: j['city'] as String,
      );
}

class FlowGuideCard {
  final String phase;
  final String greeting;
  final String oneAction;
  final String actionReason;
  final int durationMinutes;
  final int? routineId;
  final bool outfitReady;

  const FlowGuideCard({
    required this.phase,
    required this.greeting,
    required this.oneAction,
    required this.actionReason,
    required this.durationMinutes,
    this.routineId,
    required this.outfitReady,
  });

  factory FlowGuideCard.fromJson(Map<String, dynamic> j) => FlowGuideCard(
        phase: j['phase'] as String,
        greeting: j['greeting'] as String,
        oneAction: j['one_action'] as String,
        actionReason: j['action_reason'] as String,
        durationMinutes: j['duration_minutes'] as int,
        routineId: j['routine_id'] as int?,
        outfitReady: j['outfit_ready'] as bool,
      );
}

class FlowGuideResponse {
  final String phase;
  final String phaseLabel;
  final WeatherInfo? weather;
  final FlowGuideCard card;
  final String? forcedRoutine;
  final bool tomorrowOutfitSet;

  const FlowGuideResponse({
    required this.phase,
    required this.phaseLabel,
    this.weather,
    required this.card,
    this.forcedRoutine,
    required this.tomorrowOutfitSet,
  });

  factory FlowGuideResponse.fromJson(Map<String, dynamic> j) => FlowGuideResponse(
        phase: j['phase'] as String,
        phaseLabel: j['phase_label'] as String,
        weather: j['weather'] != null
            ? WeatherInfo.fromJson(j['weather'] as Map<String, dynamic>)
            : null,
        card: FlowGuideCard.fromJson(j['card'] as Map<String, dynamic>),
        forcedRoutine: j['forced_routine'] as String?,
        tomorrowOutfitSet: j['tomorrow_outfit_set'] as bool,
      );
}
