import 'package:flutter/material.dart';
import '../models/asset.dart';
import '../services/api_service.dart';

class AssetsScreen extends StatefulWidget {
  const AssetsScreen({super.key});

  @override
  State<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends State<AssetsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;
  List<Asset> _assets = [];
  bool _loading = true;
  String _category = 'clothing';

  final _categories = [
    ('clothing', '옷장', Icons.checkroom),
    ('cosmetic', '화장대', Icons.face),
    ('accessory', '액세서리', Icons.watch),
  ];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: _categories.length, vsync: this);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging) {
        setState(() => _category = _categories[_tabs.index].$1);
        _load();
      }
    });
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final assets = await apiService.getAssets(category: _category);
    setState(() { _assets = assets; _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('자산 관리'),
        centerTitle: false,
        bottom: TabBar(
          controller: _tabs,
          tabs: _categories
              .map((c) => Tab(icon: Icon(c.$3), text: c.$2))
              .toList(),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _AssetList(
              assets: _assets,
              theme: theme,
              onPatch: _patchAsset,
              onUse: _recordUse,
            ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showAddDialog,
        child: const Icon(Icons.add),
      ),
    );
  }

  Future<void> _patchAsset(int id, Map<String, dynamic> changes) async {
    final updated = await apiService.patchAsset(id, changes);
    setState(() {
      final idx = _assets.indexWhere((a) => a.id == id);
      if (idx != -1) _assets[idx] = updated;
    });
  }

  Future<void> _recordUse(int id) async {
    final updated = await apiService.recordUse(id);
    setState(() {
      final idx = _assets.indexWhere((a) => a.id == id);
      if (idx != -1) _assets[idx] = updated;
    });
  }

  void _showAddDialog() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AddAssetSheet(
        category: _category,
        onCreated: (asset) {
          setState(() => _assets.insert(0, asset));
        },
      ),
    );
  }
}

class _AssetList extends StatelessWidget {
  final List<Asset> assets;
  final ThemeData theme;
  final Future<void> Function(int, Map<String, dynamic>) onPatch;
  final Future<void> Function(int) onUse;

  const _AssetList({
    required this.assets,
    required this.theme,
    required this.onPatch,
    required this.onUse,
  });

  @override
  Widget build(BuildContext context) {
    if (assets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.add_box_outlined, size: 56, color: theme.colorScheme.primary.withOpacity(0.4)),
            const SizedBox(height: 16),
            const Text('아이템을 추가해서 자산을 쌓아보세요'),
          ],
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: assets.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => _AssetTile(
        asset: assets[i],
        theme: theme,
        onPatch: onPatch,
        onUse: onUse,
      ),
    );
  }
}

/// 인라인 편집 타일 — 탭하면 즉시 편집 모드
class _AssetTile extends StatefulWidget {
  final Asset asset;
  final ThemeData theme;
  final Future<void> Function(int, Map<String, dynamic>) onPatch;
  final Future<void> Function(int) onUse;

  const _AssetTile({
    required this.asset,
    required this.theme,
    required this.onPatch,
    required this.onUse,
  });

  @override
  State<_AssetTile> createState() => _AssetTileState();
}

class _AssetTileState extends State<_AssetTile> {
  bool _editing = false;
  late TextEditingController _nameCtrl;
  late TextEditingController _priceCtrl;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController(text: widget.asset.name);
    _priceCtrl = TextEditingController(
        text: widget.asset.purchasePrice.toStringAsFixed(0));
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    await widget.onPatch(widget.asset.id, {
      'name': _nameCtrl.text.trim(),
      'purchase_price': double.tryParse(_priceCtrl.text) ?? widget.asset.purchasePrice,
    });
    setState(() { _saving = false; _editing = false; });
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.asset;
    final theme = widget.theme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: _editing
                      ? TextField(
                          controller: _nameCtrl,
                          autofocus: true,
                          style: theme.textTheme.titleLarge,
                          decoration: const InputDecoration(
                            isDense: true,
                            border: UnderlineInputBorder(),
                          ),
                        )
                      : GestureDetector(
                          onTap: () => setState(() => _editing = true),
                          child: Text(a.name, style: theme.textTheme.titleLarge),
                        ),
                ),
                IconButton(
                  icon: Icon(Icons.add_circle_outline, color: theme.colorScheme.primary),
                  tooltip: '착용 기록',
                  onPressed: () => widget.onUse(a.id),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _StatChip(
                  label: '착용',
                  value: '${a.usageCount}회',
                  theme: theme,
                ),
                const SizedBox(width: 8),
                _StatChip(
                  label: '회당 비용',
                  value: '₩${a.costPerUse.toStringAsFixed(0)}',
                  theme: theme,
                ),
                const SizedBox(width: 8),
                _StatChip(
                  label: 'ROI',
                  value: '${a.roiValue.toStringAsFixed(0)}%',
                  theme: theme,
                  highlight: a.roiValue >= 100,
                ),
              ],
            ),
            if (_editing) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _priceCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: '구매가 (₩)',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  _saving
                      ? const SizedBox(
                          width: 24, height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : Row(
                          children: [
                            TextButton(
                              onPressed: () => setState(() => _editing = false),
                              child: const Text('취소'),
                            ),
                            FilledButton(
                              onPressed: _save,
                              child: const Text('저장'),
                            ),
                          ],
                        ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final ThemeData theme;
  final bool highlight;
  const _StatChip({
    required this.label,
    required this.value,
    required this.theme,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: highlight
            ? theme.colorScheme.primary.withOpacity(0.15)
            : theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurface.withOpacity(0.5)),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: highlight ? theme.colorScheme.primary : theme.colorScheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}

class _AddAssetSheet extends StatefulWidget {
  final String category;
  final void Function(Asset) onCreated;
  const _AddAssetSheet({required this.category, required this.onCreated});

  @override
  State<_AddAssetSheet> createState() => _AddAssetSheetState();
}

class _AddAssetSheetState extends State<_AddAssetSheet> {
  final _nameCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _brandCtrl = TextEditingController();
  bool _saving = false;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 24, right: 24, top: 24,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('새 아이템 추가', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 20),
          TextField(
            controller: _nameCtrl,
            decoration: const InputDecoration(labelText: '이름', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _brandCtrl,
            decoration: const InputDecoration(labelText: '브랜드 (선택)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _priceCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: '구매가 (₩)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving ? null : _submit,
              child: Text(_saving ? '저장 중...' : '추가하기'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (_nameCtrl.text.trim().isEmpty) return;
    setState(() => _saving = true);
    final asset = await apiService.createAsset({
      'name': _nameCtrl.text.trim(),
      'category': widget.category,
      'brand': _brandCtrl.text.trim().isEmpty ? null : _brandCtrl.text.trim(),
      'purchase_price': double.tryParse(_priceCtrl.text) ?? 0.0,
    });
    widget.onCreated(asset);
    if (mounted) Navigator.pop(context);
  }
}
