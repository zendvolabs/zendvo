import 'package:flutter/foundation.dart';

enum Sep24State { initial, loading, webViewOpen, success, error }

class Sep24Bloc extends ChangeNotifier {
  Sep24State _state = Sep24State.initial;
  Sep24State get state => _state;

  void startDeposit() => _setState(Sep24State.loading);
  void onWebViewOpened() => _setState(Sep24State.webViewOpen);
  void onSuccess() => _setState(Sep24State.success);
  void onError() => _setState(Sep24State.error);

  void _setState(Sep24State newState) {
    _state = newState;
    notifyListeners();
  }
}

// Placeholder: Savings Data Model
// Strongly typed model for the savings dashboard data.
class SavingsDataModel {
  final String balance;
  final String apy;

  SavingsDataModel({required this.balance, required this.apy});

  factory SavingsDataModel.fromJson(Map<String, dynamic> json) {
    return SavingsDataModel(
      balance: json['balance'] ?? '0.0',
      apy: json['apy'] ?? '0.0',
    );
  }
}