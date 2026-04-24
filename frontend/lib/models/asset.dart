class Asset {
  final int id;
  final String name;
  final String category;
  final String? brand;
  final String? color;
  final String? season;
  final double purchasePrice;
  final String? purchaseDate;
  final int usageCount;
  final String? lastUsedAt;
  final String? imageUrl;
  final List<String>? tags;
  final String? notes;
  final bool isActive;
  final double costPerUse;
  final double roiValue;

  const Asset({
    required this.id,
    required this.name,
    required this.category,
    this.brand,
    this.color,
    this.season,
    required this.purchasePrice,
    this.purchaseDate,
    required this.usageCount,
    this.lastUsedAt,
    this.imageUrl,
    this.tags,
    this.notes,
    required this.isActive,
    required this.costPerUse,
    required this.roiValue,
  });

  factory Asset.fromJson(Map<String, dynamic> j) => Asset(
        id: j['id'] as int,
        name: j['name'] as String,
        category: j['category'] as String,
        brand: j['brand'] as String?,
        color: j['color'] as String?,
        season: j['season'] as String?,
        purchasePrice: (j['purchase_price'] as num).toDouble(),
        purchaseDate: j['purchase_date'] as String?,
        usageCount: j['usage_count'] as int,
        lastUsedAt: j['last_used_at'] as String?,
        imageUrl: j['image_url'] as String?,
        tags: (j['tags'] as List?)?.cast<String>(),
        notes: j['notes'] as String?,
        isActive: j['is_active'] as bool,
        costPerUse: (j['cost_per_use'] as num).toDouble(),
        roiValue: (j['roi_value'] as num).toDouble(),
      );

  Asset copyWith({
    String? name,
    String? brand,
    String? color,
    String? season,
    double? purchasePrice,
    String? notes,
    List<String>? tags,
  }) =>
      Asset(
        id: id,
        name: name ?? this.name,
        category: category,
        brand: brand ?? this.brand,
        color: color ?? this.color,
        season: season ?? this.season,
        purchasePrice: purchasePrice ?? this.purchasePrice,
        purchaseDate: purchaseDate,
        usageCount: usageCount,
        lastUsedAt: lastUsedAt,
        imageUrl: imageUrl,
        tags: tags ?? this.tags,
        notes: notes ?? this.notes,
        isActive: isActive,
        costPerUse: costPerUse,
        roiValue: roiValue,
      );
}
