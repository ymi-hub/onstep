import 'package:dio/dio.dart';
import '../models/asset.dart';
import '../models/flow_guide.dart';

class ApiService {
  static const _baseUrl = 'http://localhost:8000';

  final Dio _dio = Dio(BaseOptions(
    baseUrl: _baseUrl,
    connectTimeout: const Duration(seconds: 5),
    receiveTimeout: const Duration(seconds: 10),
  ));

  Future<FlowGuideResponse> getFlowGuide({String city = 'Seoul'}) async {
    final res = await _dio.get('/flow-guide/', queryParameters: {'city': city});
    return FlowGuideResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<Asset>> getAssets({
    String? category,
    String? season,
    bool isActive = true,
  }) async {
    final res = await _dio.get('/assets/', queryParameters: {
      if (category != null) 'category': category,
      if (season != null) 'season': season,
      'is_active': isActive,
    });
    return (res.data as List).map((e) => Asset.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Asset> createAsset(Map<String, dynamic> data) async {
    final res = await _dio.post('/assets/', data: data);
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  /// 인라인 편집 — 변경된 필드만 전송
  Future<Asset> patchAsset(int id, Map<String, dynamic> changes) async {
    final res = await _dio.patch('/assets/$id', data: changes);
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Asset> recordUse(int id) async {
    final res = await _dio.post('/assets/$id/use');
    return Asset.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> deleteAsset(int id) async {
    await _dio.delete('/assets/$id');
  }
}

final apiService = ApiService();
