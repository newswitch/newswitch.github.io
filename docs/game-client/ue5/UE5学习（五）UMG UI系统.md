---
title: UE5学习（五）UMG UI系统
date: 2026-02-24 12:00:00
categories: UE5
tags: [UE5, Unreal Engine, UMG, UI系统, 用户界面, Widget, 游戏开发]
---

# UE5学习（五）UMG UI系统

> 本文是 UE5 学习系列的第五篇，面向刚开始接触 UE5 的开发者。我们将从零开始，深入理解 UE5 UMG UI 系统的原理，并通过完整的代码示例学会如何使用。

## 1. UMG UI 系统概述

### 1.1 什么是 UMG

**UMG（Unreal Motion Graphics）** 是 UE5 的 UI 系统，用于创建游戏中的用户界面。它提供了可视化的编辑器，让开发者可以通过拖拽的方式创建 UI，无需编写大量代码。

**通俗理解：**

想象你在设计一个手机 App 的界面，UMG 就像是 UE5 的"界面设计器"。你可以：
- 拖拽按钮、文本、图片等控件
- 设置它们的位置、大小、颜色
- 添加动画和交互效果
- 在代码中控制 UI 的显示和隐藏

### 1.2 为什么需要 UMG

在游戏开发中，UI 系统有广泛的应用：

1. **游戏 HUD**：
   - 生命值、魔法值显示
   - 小地图
   - 武器信息
   - 任务提示

2. **菜单系统**：
   - 主菜单
   - 设置菜单
   - 暂停菜单
   - 背包菜单

3. **对话框系统**：
   - NPC 对话
   - 任务对话框
   - 确认对话框

4. **游戏内 UI**：
   - 商店界面
   - 技能树
   - 成就系统

### 1.3 UMG 的核心概念

**Widget（控件）**：
- UI 的基本单位
- 可以是按钮、文本、图片等
- 可以嵌套组合成复杂的 UI

**Widget Blueprint（控件蓝图）**：
- 可视化的 UI 编辑器
- 类似于普通蓝图，但专门用于 UI

**Slot（插槽）**：
- 控件在父控件中的位置和大小
- 每个控件都有一个 Slot

**Anchors（锚点）**：
- 定义控件相对于父控件的位置
- 用于响应式布局

**Animation（动画）**：
- UI 的动画效果
- 淡入淡出、滑动等

### 1.4 UMG 的工作流程

```
1. 创建 Widget Blueprint
   - 在内容浏览器中创建
   ↓
2. 设计 UI 布局
   - 添加控件（按钮、文本等）
   - 设置位置、大小、样式
   ↓
3. 添加交互逻辑
   - 绑定按钮事件
   - 设置数据绑定
   ↓
4. 在代码中创建和显示
   - 创建 Widget 实例
   - 添加到视口
   ↓
5. 更新和销毁
   - 更新 UI 数据
   - 移除 UI
```

## 2. 基础控件

### 2.1 常用控件类型

UMG 提供了丰富的控件类型：

**基础控件：**
- **Text**：文本显示
- **Rich Text**：富文本（支持样式）
- **Editable Text**：可编辑文本
- **Multi-line Editable Text**：多行可编辑文本

**按钮控件：**
- **Button**：按钮
- **Check Box**：复选框
- **Radio Button**：单选按钮
- **Combo Box**：下拉框

**图片控件：**
- **Image**：图片
- **Border**：边框
- **Background Blur**：背景模糊

**布局控件：**
- **Canvas Panel**：画布面板（自由布局）
- **Vertical Box**：垂直盒子
- **Horizontal Box**：水平盒子
- **Grid Panel**：网格面板
- **Uniform Grid Panel**：均匀网格面板
- **Wrap Box**：换行盒子
- **Size Box**：尺寸盒子
- **Scroll Box**：滚动盒子

**进度控件：**
- **Progress Bar**：进度条
- **Circular Throbber**：圆形加载动画
- **Spinning Throbber**：旋转加载动画

**列表控件：**
- **List View**：列表视图
- **Tree View**：树形视图

### 2.2 控件的常用属性

**通用属性：**
- **Visibility**：可见性（Visible、Collapsed、Hidden、Hit Test Invisible）
- **Is Enabled**：是否启用
- **Render Transform**：渲染变换（位置、旋转、缩放）
- **Render Opacity**：透明度（0-1）

**布局属性：**
- **Anchors**：锚点
- **Offsets**：偏移量
- **Size To Content**：根据内容调整大小
- **Auto Size**：自动调整大小

**样式属性：**
- **Color and Opacity**：颜色和透明度
- **Font**：字体
- **Justification**：对齐方式

## 3. 创建 Widget

### 3.1 创建 Widget Blueprint

**步骤 1：创建 Widget Blueprint**

1. 在内容浏览器中右键点击
2. 选择 `User Interface > Widget Blueprint`
3. 命名并创建（例如：`WBP_MainMenu`）

**步骤 2：打开 Widget 编辑器**

双击 Widget Blueprint 打开编辑器，你会看到：
- **Designer**：可视化设计界面
- **Graph**：蓝图逻辑编辑
- **Details**：属性面板
- **Palette**：控件面板

**步骤 3：添加控件**

1. 从 **Palette** 面板拖拽控件到 **Designer**
2. 在 **Details** 面板中设置属性
3. 使用 **Anchors** 设置位置

### 3.2 基础 UI 示例：主菜单

创建一个简单的主菜单：

**步骤：**
1. 创建 Widget Blueprint：`WBP_MainMenu`
2. 添加控件：
   - **Canvas Panel**（根控件）
   - **Text**：标题 "游戏标题"
   - **Button**：开始游戏
   - **Button**：设置
   - **Button**：退出游戏

3. 设置布局：
   - 使用 Anchors 居中排列按钮
   - 设置按钮大小和间距

4. 设置样式：
   - 设置文本字体和颜色
   - 设置按钮背景和文本

## 4. 在代码中使用 Widget

### 4.1 创建 Widget 类

首先创建一个 C++ Widget 类：

```cpp
// MainMenuWidget.h
#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "MainMenuWidget.generated.h"

UCLASS()
class MYGAME_API UMainMenuWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    UMainMenuWidget(const FObjectInitializer& ObjectInitializer);

    virtual void NativeConstruct() override;
    virtual void NativeDestruct() override;

protected:
    // 按钮引用（在 Widget Blueprint 中绑定）
    UPROPERTY(meta = (BindWidget))
    class UButton* StartGameButton;

    UPROPERTY(meta = (BindWidget))
    class UButton* SettingsButton;

    UPROPERTY(meta = (BindWidget))
    class UButton* QuitGameButton;

    // 文本引用
    UPROPERTY(meta = (BindWidget))
    class UTextBlock* TitleText;

    // 按钮事件
    UFUNCTION()
    void OnStartGameClicked();

    UFUNCTION()
    void OnSettingsClicked();

    UFUNCTION()
    void OnQuitGameClicked();
};

// MainMenuWidget.cpp
#include "MainMenuWidget.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

UMainMenuWidget::UMainMenuWidget(const FObjectInitializer& ObjectInitializer)
    : Super(ObjectInitializer)
{
}

void UMainMenuWidget::NativeConstruct()
{
    Super::NativeConstruct();

    // 绑定按钮事件
    if (StartGameButton)
    {
        StartGameButton->OnClicked.AddDynamic(this, &UMainMenuWidget::OnStartGameClicked);
    }

    if (SettingsButton)
    {
        SettingsButton->OnClicked.AddDynamic(this, &UMainMenuWidget::OnSettingsClicked);
    }

    if (QuitGameButton)
    {
        QuitGameButton->OnClicked.AddDynamic(this, &UMainMenuWidget::OnQuitGameClicked);
    }

    // 设置标题文本
    if (TitleText)
    {
        TitleText->SetText(FText::FromString(TEXT("我的游戏")));
    }
}

void UMainMenuWidget::NativeDestruct()
{
    Super::NativeDestruct();

    // 解绑事件（通常不需要，但最好做）
    if (StartGameButton)
    {
        StartGameButton->OnClicked.RemoveAll(this);
    }

    if (SettingsButton)
    {
        SettingsButton->OnClicked.RemoveAll(this);
    }

    if (QuitGameButton)
    {
        QuitGameButton->OnClicked.RemoveAll(this);
    }
}

void UMainMenuWidget::OnStartGameClicked()
{
    UE_LOG(LogTemp, Warning, TEXT("Start Game clicked!"));
    
    // 加载游戏关卡
    UGameplayStatics::OpenLevel(GetWorld(), TEXT("GameLevel"));
}

void UMainMenuWidget::OnSettingsClicked()
{
    UE_LOG(LogTemp, Warning, TEXT("Settings clicked!"));
    
    // 打开设置菜单
    // 这里可以创建并显示设置 Widget
}

void UMainMenuWidget::OnQuitGameClicked()
{
    UE_LOG(LogTemp, Warning, TEXT("Quit Game clicked!"));
    
    // 退出游戏
    UKismetSystemLibrary::QuitGame(
        GetWorld(),
        GetOwningPlayer(),
        EQuitPreference::Quit,
        false
    );
}
```

### 4.2 显示 Widget

在 Player Controller 或 Game Mode 中创建并显示 Widget：

```cpp
// MyPlayerController.h
UCLASS()
class MYGAME_API AMyPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    AMyPlayerController();

protected:
    virtual void BeginPlay() override;

    // Widget 类引用
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "UI")
    TSubclassOf<class UUserWidget> MainMenuWidgetClass;

    // Widget 实例
    UPROPERTY()
    class UMainMenuWidget* MainMenuWidget;
};

// MyPlayerController.cpp
#include "MyPlayerController.h"
#include "MainMenuWidget.h"
#include "Blueprint/UserWidget.h"

AMyPlayerController::AMyPlayerController()
{
    PrimaryActorTick.bCanEverTick = false;
}

void AMyPlayerController::BeginPlay()
{
    Super::BeginPlay();

    // 创建并显示主菜单
    if (MainMenuWidgetClass)
    {
        MainMenuWidget = CreateWidget<UMainMenuWidget>(this, MainMenuWidgetClass);
        if (MainMenuWidget)
        {
            MainMenuWidget->AddToViewport();
            
            // 设置输入模式（显示鼠标，暂停游戏）
            SetInputMode(FInputModeUIOnly());
            SetShowMouseCursor(true);
        }
    }
}
```

### 4.3 动态更新 UI

在运行时更新 UI 内容：

```cpp
// HUDWidget.h
UCLASS()
class MYGAME_API UHUDWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    virtual void NativeConstruct() override;

    // 更新生命值显示
    UFUNCTION(BlueprintCallable, Category = "UI")
    void UpdateHealth(float CurrentHealth, float MaxHealth);

    // 更新分数显示
    UFUNCTION(BlueprintCallable, Category = "UI")
    void UpdateScore(int32 NewScore);

protected:
    UPROPERTY(meta = (BindWidget))
    class UProgressBar* HealthBar;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* HealthText;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* ScoreText;
};

// HUDWidget.cpp
#include "HUDWidget.h"
#include "Components/ProgressBar.h"
#include "Components/TextBlock.h"

void UHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
}

void UHUDWidget::UpdateHealth(float CurrentHealth, float MaxHealth)
{
    if (HealthBar)
    {
        // 更新进度条（0.0 - 1.0）
        float HealthPercent = MaxHealth > 0.0f ? CurrentHealth / MaxHealth : 0.0f;
        HealthBar->SetPercent(HealthPercent);
    }

    if (HealthText)
    {
        // 更新文本
        FString HealthString = FString::Printf(TEXT("%.0f / %.0f"), CurrentHealth, MaxHealth);
        HealthText->SetText(FText::FromString(HealthString));
    }
}

void UHUDWidget::UpdateScore(int32 NewScore)
{
    if (ScoreText)
    {
        FString ScoreString = FString::Printf(TEXT("Score: %d"), NewScore);
        ScoreText->SetText(FText::FromString(ScoreString));
    }
}
```

## 5. 布局系统

### 5.1 布局控件

**Canvas Panel（画布面板）**：
- 自由布局，可以任意放置控件
- 使用 Anchors 和 Offsets 定位
- 适合复杂的自定义布局

**Vertical Box（垂直盒子）**：
- 垂直排列子控件
- 自动处理间距和对齐
- 适合列表布局

**Horizontal Box（水平盒子）**：
- 水平排列子控件
- 自动处理间距和对齐
- 适合工具栏、按钮组

**Grid Panel（网格面板）**：
- 网格布局
- 可以设置行和列
- 适合表格、技能树

**示例：使用 Vertical Box 创建按钮列表**

```cpp
// 在 Widget Blueprint 中：
// 1. 添加 Vertical Box
// 2. 添加多个 Button 作为子控件
// 3. 设置 Vertical Box 的 Padding 和 Spacing
```

### 5.2 Anchors（锚点）

**什么是锚点：**

锚点定义了控件相对于父控件的位置关系。当屏幕大小改变时，控件会根据锚点自动调整位置。

**锚点类型：**

- **Top Left**：左上角
- **Top Center**：顶部居中
- **Top Right**：右上角
- **Center Left**：左侧居中
- **Center**：居中
- **Center Right**：右侧居中
- **Bottom Left**：左下角
- **Bottom Center**：底部居中
- **Bottom Right**：右下角

**使用示例：**

```cpp
// 在代码中设置锚点
void UMyWidget::SetAnchors()
{
    if (MyButton)
    {
        // 设置锚点为底部居中
        MyButton->SetAnchorsInViewport(FAnchors(0.5f, 1.0f, 0.5f, 1.0f));
        
        // 设置偏移量（距离底部 50 像素，宽度 200，高度 50）
        MyButton->SetOffsetsInViewport(FMargin(0, 0, 200, 50));
    }
}
```

### 5.3 响应式布局

创建适应不同屏幕尺寸的 UI：

```cpp
// ResponsiveWidget.h
UCLASS()
class MYGAME_API UResponsiveWidget : public UUserWidget
{
    GENERATED_BODY()

protected:
    virtual void NativeConstruct() override;
    virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

    // 响应屏幕大小变化
    void UpdateLayout();

    UPROPERTY(meta = (BindWidget))
    class UCanvasPanel* RootCanvas;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* TitleText;

    FVector2D LastViewportSize;
};

// ResponsiveWidget.cpp
#include "ResponsiveWidget.h"
#include "Components/CanvasPanel.h"
#include "Components/TextBlock.h"
#include "Engine/Engine.h"

void UResponsiveWidget::NativeConstruct()
{
    Super::NativeConstruct();
    
    // 获取初始视口大小
    if (GEngine && GEngine->GameViewport)
    {
        FVector2D ViewportSize;
        GEngine->GameViewport->GetViewportSize(ViewportSize);
        LastViewportSize = ViewportSize;
    }
}

void UResponsiveWidget::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
    Super::NativeTick(MyGeometry, InDeltaTime);

    // 检查视口大小是否改变
    if (GEngine && GEngine->GameViewport)
    {
        FVector2D ViewportSize;
        GEngine->GameViewport->GetViewportSize(ViewportSize);
        
        if (ViewportSize != LastViewportSize)
        {
            UpdateLayout();
            LastViewportSize = ViewportSize;
        }
    }
}

void UResponsiveWidget::UpdateLayout()
{
    // 根据屏幕大小调整布局
    // 例如：在小屏幕上缩小字体，调整按钮位置等
    if (TitleText)
    {
        // 可以根据屏幕大小调整字体大小
        // FSlateFontInfo FontInfo = TitleText->GetFont();
        // FontInfo.Size = ...;
        // TitleText->SetFont(FontInfo);
    }
}
```

## 6. 动画和过渡

### 6.1 Widget 动画

在 Widget Blueprint 中创建动画：

**步骤：**
1. 打开 Widget Blueprint
2. 切换到 **Animations** 标签
3. 点击 **+ Animation** 创建新动画
4. 添加关键帧和属性变化
5. 在 Graph 中播放动画

**示例：淡入动画**

```cpp
// 在 Widget Blueprint 的 Graph 中：
// 1. 创建动画：FadeIn
// 2. 设置 Render Opacity 从 0 到 1
// 3. 在 NativeConstruct 中播放动画

void UMyWidget::NativeConstruct()
{
    Super::NativeConstruct();
    
    // 播放淡入动画
    PlayAnimation(FadeInAnimation);
}
```

### 6.2 在代码中控制动画

```cpp
// AnimatedWidget.h
UCLASS()
class MYGAME_API UAnimatedWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    virtual void NativeConstruct() override;

    // 显示 Widget（带动画）
    UFUNCTION(BlueprintCallable, Category = "UI")
    void ShowWidget();

    // 隐藏 Widget（带动画）
    UFUNCTION(BlueprintCallable, Category = "UI")
    void HideWidget();

protected:
    // 动画引用（在 Widget Blueprint 中创建）
    UPROPERTY(BlueprintReadOnly, meta = (BindWidgetAnim), Category = "Animations")
    class UWidgetAnimation* FadeInAnimation;

    UPROPERTY(BlueprintReadOnly, meta = (BindWidgetAnim), Category = "Animations")
    class UWidgetAnimation* FadeOutAnimation;
};

// AnimatedWidget.cpp
#include "AnimatedWidget.h"
#include "Animation/WidgetAnimation.h"

void UAnimatedWidget::NativeConstruct()
{
    Super::NativeConstruct();
    
    // 初始状态：隐藏
    SetRenderOpacity(0.0f);
}

void UAnimatedWidget::ShowWidget()
{
    // 显示并播放淡入动画
    SetVisibility(ESlateVisibility::Visible);
    
    if (FadeInAnimation)
    {
        PlayAnimation(FadeInAnimation);
    }
    else
    {
        // 如果没有动画，直接设置透明度
        SetRenderOpacity(1.0f);
    }
}

void UAnimatedWidget::HideWidget()
{
    if (FadeOutAnimation)
    {
        // 播放淡出动画，完成后隐藏
        PlayAnimation(FadeOutAnimation);
        
        // 在动画完成后隐藏（需要在动画完成事件中调用）
        // SetVisibility(ESlateVisibility::Hidden);
    }
    else
    {
        // 如果没有动画，直接隐藏
        SetRenderOpacity(0.0f);
        SetVisibility(ESlateVisibility::Hidden);
    }
}
```

## 7. 实际应用场景

### 7.1 场景 1：游戏 HUD

创建一个游戏 HUD，显示生命值、魔法值、分数等。

```cpp
// GameHUDWidget.h
UCLASS()
class MYGAME_API UGameHUDWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    virtual void NativeConstruct() override;

    // 更新生命值
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void UpdateHealth(float Current, float Max);

    // 更新魔法值
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void UpdateMana(float Current, float Max);

    // 更新分数
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void UpdateScore(int32 Score);

    // 显示/隐藏伤害数字
    UFUNCTION(BlueprintCallable, Category = "HUD")
    void ShowDamageNumber(float Damage, FVector WorldLocation);

protected:
    UPROPERTY(meta = (BindWidget))
    class UProgressBar* HealthBar;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* HealthText;

    UPROPERTY(meta = (BindWidget))
    class UProgressBar* ManaBar;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* ManaText;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* ScoreText;

    UPROPERTY(meta = (BindWidget))
    class UCanvasPanel* DamageNumberCanvas;

    // 伤害数字 Widget 类
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "HUD")
    TSubclassOf<class UUserWidget> DamageNumberWidgetClass;
};

// GameHUDWidget.cpp
#include "GameHUDWidget.h"
#include "Components/ProgressBar.h"
#include "Components/TextBlock.h"
#include "Components/CanvasPanel.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/CameraComponent.h"

void UGameHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
}

void UGameHUDWidget::UpdateHealth(float Current, float Max)
{
    if (HealthBar)
    {
        HealthBar->SetPercent(Max > 0.0f ? Current / Max : 0.0f);
    }

    if (HealthText)
    {
        FString HealthString = FString::Printf(TEXT("%.0f / %.0f"), Current, Max);
        HealthText->SetText(FText::FromString(HealthString));
    }
}

void UGameHUDWidget::UpdateMana(float Current, float Max)
{
    if (ManaBar)
    {
        ManaBar->SetPercent(Max > 0.0f ? Current / Max : 0.0f);
    }

    if (ManaText)
    {
        FString ManaString = FString::Printf(TEXT("%.0f / %.0f"), Current, Max);
        ManaText->SetText(FText::FromString(ManaString));
    }
}

void UGameHUDWidget::UpdateScore(int32 Score)
{
    if (ScoreText)
    {
        FString ScoreString = FString::Printf(TEXT("Score: %d"), Score);
        ScoreText->SetText(FText::FromString(ScoreString));
    }
}

void UGameHUDWidget::ShowDamageNumber(float Damage, FVector WorldLocation)
{
    if (!DamageNumberWidgetClass || !DamageNumberCanvas)
    {
        return;
    }

    // 创建伤害数字 Widget
    UUserWidget* DamageWidget = CreateWidget<UUserWidget>(GetWorld(), DamageNumberWidgetClass);
    if (DamageWidget)
    {
        // 添加到画布
        DamageNumberCanvas->AddChild(DamageWidget);

        // 将世界坐标转换为屏幕坐标
        APlayerController* PC = GetOwningPlayer();
        if (PC)
        {
            FVector2D ScreenLocation;
            if (UGameplayStatics::ProjectWorldToScreen(PC, WorldLocation, ScreenLocation))
            {
                // 设置位置
                DamageWidget->SetPositionInViewport(ScreenLocation);
            }
        }

        // 播放动画（假设 Widget 有淡出动画）
        // DamageWidget->PlayAnimation(...);

        // 延迟后移除（可以在动画完成事件中处理）
        FTimerHandle TimerHandle;
        GetWorld()->GetTimerManager().SetTimer(
            TimerHandle,
            [DamageWidget]()
            {
                if (DamageWidget)
                {
                    DamageWidget->RemoveFromParent();
                }
            },
            2.0f,
            false
        );
    }
}
```

### 7.2 场景 2：对话框系统

创建一个对话框系统，用于 NPC 对话。

```cpp
// DialogueWidget.h
UCLASS()
class MYGAME_API UDialogueWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    virtual void NativeConstruct() override;

    // 显示对话
    UFUNCTION(BlueprintCallable, Category = "Dialogue")
    void ShowDialogue(const FString& SpeakerName, const FString& DialogueText);

    // 显示下一句对话
    UFUNCTION(BlueprintCallable, Category = "Dialogue")
    void ShowNextDialogue();

    // 关闭对话
    UFUNCTION(BlueprintCallable, Category = "Dialogue")
    void CloseDialogue();

protected:
    UPROPERTY(meta = (BindWidget))
    class UTextBlock* SpeakerNameText;

    UPROPERTY(meta = (BindWidget))
    class UTextBlock* DialogueText;

    UPROPERTY(meta = (BindWidget))
    class UButton* NextButton;

    UPROPERTY(meta = (BindWidget))
    class UButton* CloseButton;

    // 对话数据
    TArray<FDialogueData> DialogueQueue;
    int32 CurrentDialogueIndex = 0;

    UFUNCTION()
    void OnNextButtonClicked();

    UFUNCTION()
    void OnCloseButtonClicked();

    // 对话数据结构
    USTRUCT(BlueprintType)
    struct FDialogueData
    {
        GENERATED_BODY()

        UPROPERTY(BlueprintReadWrite)
        FString SpeakerName;

        UPROPERTY(BlueprintReadWrite)
        FString Text;
    };
};

// DialogueWidget.cpp
#include "DialogueWidget.h"
#include "Components/TextBlock.h"
#include "Components/Button.h"

void UDialogueWidget::NativeConstruct()
{
    Super::NativeConstruct();

    if (NextButton)
    {
        NextButton->OnClicked.AddDynamic(this, &UDialogueWidget::OnNextButtonClicked);
    }

    if (CloseButton)
    {
        CloseButton->OnClicked.AddDynamic(this, &UDialogueWidget::OnCloseButtonClicked);
    }
}

void UDialogueWidget::ShowDialogue(const FString& SpeakerName, const FString& DialogueText)
{
    // 添加对话到队列
    FDialogueData NewDialogue;
    NewDialogue.SpeakerName = SpeakerName;
    NewDialogue.Text = DialogueText;
    DialogueQueue.Add(NewDialogue);

    // 如果是第一条对话，立即显示
    if (DialogueQueue.Num() == 1)
    {
        ShowNextDialogue();
    }
}

void UDialogueWidget::ShowNextDialogue()
{
    if (CurrentDialogueIndex < DialogueQueue.Num())
    {
        FDialogueData CurrentDialogue = DialogueQueue[CurrentDialogueIndex];

        if (SpeakerNameText)
        {
            SpeakerNameText->SetText(FText::FromString(CurrentDialogue.SpeakerName));
        }

        if (DialogueText)
        {
            DialogueText->SetText(FText::FromString(CurrentDialogue.Text));
        }

        CurrentDialogueIndex++;
    }
    else
    {
        // 所有对话显示完毕
        CloseDialogue();
    }
}

void UDialogueWidget::CloseDialogue()
{
    // 清空队列
    DialogueQueue.Empty();
    CurrentDialogueIndex = 0;

    // 隐藏 Widget
    SetVisibility(ESlateVisibility::Hidden);

    // 恢复游戏输入
    APlayerController* PC = GetOwningPlayer();
    if (PC)
    {
        PC->SetInputMode(FInputModeGameOnly());
        PC->SetShowMouseCursor(false);
    }
}

void UDialogueWidget::OnNextButtonClicked()
{
    ShowNextDialogue();
}

void UDialogueWidget::OnCloseButtonClicked()
{
    CloseDialogue();
}
```

### 7.3 场景 3：设置菜单

创建一个设置菜单，允许玩家调整游戏设置。

```cpp
// SettingsWidget.h
UCLASS()
class MYGAME_API USettingsWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    virtual void NativeConstruct() override;

    // 应用设置
    UFUNCTION(BlueprintCallable, Category = "Settings")
    void ApplySettings();

    // 恢复默认设置
    UFUNCTION(BlueprintCallable, Category = "Settings")
    void ResetToDefaults();

protected:
    UPROPERTY(meta = (BindWidget))
    class USlider* MasterVolumeSlider;

    UPROPERTY(meta = (BindWidget))
    class USlider* MusicVolumeSlider;

    UPROPERTY(meta = (BindWidget))
    class USlider* SFXVolumeSlider;

    UPROPERTY(meta = (BindWidget))
    class UCheckBox* FullscreenCheckBox;

    UPROPERTY(meta = (BindWidget))
    class UComboBoxString* ResolutionComboBox;

    UPROPERTY(meta = (BindWidget))
    class UButton* ApplyButton;

    UPROPERTY(meta = (BindWidget))
    class UButton* CancelButton;

    UFUNCTION()
    void OnMasterVolumeChanged(float Value);

    UFUNCTION()
    void OnMusicVolumeChanged(float Value);

    UFUNCTION()
    void OnSFXVolumeChanged(float Value);

    UFUNCTION()
    void OnApplyButtonClicked();

    UFUNCTION()
    void OnCancelButtonClicked();

    // 保存设置
    void SaveSettings();
    void LoadSettings();
};

// SettingsWidget.cpp
#include "SettingsWidget.h"
#include "Components/Slider.h"
#include "Components/CheckBox.h"
#include "Components/ComboBoxString.h"
#include "Components/Button.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/GameUserSettings.h"

void USettingsWidget::NativeConstruct()
{
    Super::NativeConstruct();

    // 绑定事件
    if (MasterVolumeSlider)
    {
        MasterVolumeSlider->OnValueChanged.AddDynamic(this, &USettingsWidget::OnMasterVolumeChanged);
    }

    if (MusicVolumeSlider)
    {
        MusicVolumeSlider->OnValueChanged.AddDynamic(this, &USettingsWidget::OnMusicVolumeChanged);
    }

    if (SFXVolumeSlider)
    {
        SFXVolumeSlider->OnValueChanged.AddDynamic(this, &USettingsWidget::OnSFXVolumeChanged);
    }

    if (ApplyButton)
    {
        ApplyButton->OnClicked.AddDynamic(this, &USettingsWidget::OnApplyButtonClicked);
    }

    if (CancelButton)
    {
        CancelButton->OnClicked.AddDynamic(this, &USettingsWidget::OnCancelButtonClicked);
    }

    // 加载设置
    LoadSettings();
}

void USettingsWidget::OnMasterVolumeChanged(float Value)
{
    // 实时更新音量（可选）
    // UGameplayStatics::SetSoundClassVolume(...);
}

void USettingsWidget::OnMusicVolumeChanged(float Value)
{
    // 实时更新音乐音量
}

void USettingsWidget::OnSFXVolumeChanged(float Value)
{
    // 实时更新音效音量
}

void USettingsWidget::OnApplyButtonClicked()
{
    ApplySettings();
    SaveSettings();
    
    // 关闭设置菜单
    RemoveFromParent();
}

void USettingsWidget::OnCancelButtonClicked()
{
    // 恢复设置
    LoadSettings();
    
    // 关闭设置菜单
    RemoveFromParent();
}

void USettingsWidget::ApplySettings()
{
    // 应用音量设置
    if (MasterVolumeSlider)
    {
        float MasterVolume = MasterVolumeSlider->GetValue();
        // UGameplayStatics::SetSoundClassVolume(...);
    }

    // 应用显示设置
    UGameUserSettings* UserSettings = UGameUserSettings::GetGameUserSettings();
    if (UserSettings)
    {
        if (FullscreenCheckBox)
        {
            bool bFullscreen = FullscreenCheckBox->IsChecked();
            UserSettings->SetFullscreenMode(bFullscreen ? EWindowMode::Fullscreen : EWindowMode::Windowed);
        }

        if (ResolutionComboBox)
        {
            FString SelectedResolution = ResolutionComboBox->GetSelectedOption();
            // 解析分辨率字符串并设置
            // UserSettings->SetScreenResolution(...);
        }

        UserSettings->ApplySettings(false);
    }
}

void USettingsWidget::SaveSettings()
{
    // 保存设置到配置文件
    // 可以使用 UGameplayStatics::SaveGameToSlot(...)
}

void USettingsWidget::LoadSettings()
{
    // 从配置文件加载设置
    // 可以使用 UGameplayStatics::LoadGameFromSlot(...)
    
    // 设置滑块值
    // MasterVolumeSlider->SetValue(...);
}
```

## 8. 性能优化

### 8.1 Widget 性能优化

**问题：** 复杂的 UI 可能影响性能。

**优化方法：**

1. **减少 Widget 数量**：
   - 合并相似的控件
   - 使用单个复杂控件代替多个简单控件

2. **使用 Widget Pooling（对象池）**：
   - 对于频繁创建和销毁的 Widget，使用对象池
   - 减少内存分配开销

3. **优化动画**：
   - 避免同时播放过多动画
   - 使用简单的动画代替复杂的动画

4. **减少 Tick**：
   - 避免在 Widget 中使用 Tick
   - 使用事件驱动代替轮询

```cpp
// WidgetPool.h
UCLASS()
class MYGAME_API UWidgetPool : public UObject
{
    GENERATED_BODY()

public:
    // 获取 Widget（从池中获取或创建新的）
    UUserWidget* GetWidget(TSubclassOf<UUserWidget> WidgetClass);

    // 归还 Widget（放回池中）
    void ReturnWidget(UUserWidget* Widget);

private:
    // Widget 池
    TMap<TSubclassOf<UUserWidget>, TArray<UUserWidget*>> WidgetPool;
};

// WidgetPool.cpp
UUserWidget* UWidgetPool::GetWidget(TSubclassOf<UUserWidget> WidgetClass)
{
    if (!WidgetClass)
    {
        return nullptr;
    }

    // 检查池中是否有可用的 Widget
    if (WidgetPool.Contains(WidgetClass) && WidgetPool[WidgetClass].Num() > 0)
    {
        UUserWidget* Widget = WidgetPool[WidgetClass].Pop();
        Widget->SetVisibility(ESlateVisibility::Visible);
        return Widget;
    }

    // 创建新的 Widget
    // 注意：需要传入有效的 World 和 Player
    // UUserWidget* NewWidget = CreateWidget<UUserWidget>(World, WidgetClass);
    // return NewWidget;

    return nullptr;
}

void UWidgetPool::ReturnWidget(UUserWidget* Widget)
{
    if (!Widget)
    {
        return;
    }

    // 隐藏 Widget
    Widget->SetVisibility(ESlateVisibility::Collapsed);

    // 放回池中
    TSubclassOf<UUserWidget> WidgetClass = Widget->GetClass();
    if (!WidgetPool.Contains(WidgetClass))
    {
        WidgetPool.Add(WidgetClass, TArray<UUserWidget*>());
    }
    WidgetPool[WidgetClass].Add(Widget);
}
```

### 8.2 渲染优化

**优化方法：**

1. **使用 Render Transform 代替重新布局**：
   - 对于动画，使用 Render Transform
   - 避免频繁改变布局

2. **减少透明度变化**：
   - 透明度变化需要重新渲染
   - 批量处理透明度变化

3. **使用 Texture Atlas**：
   - 将多个小图片合并成大图
   - 减少 Draw Call

### 8.3 内存优化

**优化方法：**

1. **及时销毁 Widget**：
   - 不再使用的 Widget 及时调用 `RemoveFromParent()`
   - 避免内存泄漏

2. **使用 Soft References**：
   - 对于不常用的 Widget，使用软引用
   - 延迟加载

3. **避免循环引用**：
   - Widget 之间避免相互引用
   - 使用弱引用或事件系统

## 9. 常见问题与最佳实践

### 9.1 常见问题

**Q: Widget 不显示？**

A: 检查以下几点：
1. 是否调用了 `AddToViewport()`？
2. Widget 的 Visibility 是否正确？
3. Widget 是否在屏幕范围内？
4. Z-Order 是否被其他 Widget 遮挡？

**Q: 按钮点击无响应？**

A: 检查以下几点：
1. 按钮是否启用（Is Enabled）？
2. 是否绑定了点击事件？
3. 是否有其他控件遮挡按钮？
4. 输入模式是否正确？

**Q: 动画不播放？**

A: 检查以下几点：
1. 动画是否在 Widget Blueprint 中正确创建？
2. 是否调用了 `PlayAnimation()`？
3. Widget 是否可见？
4. 动画时长是否正确？

**Q: 布局不正确？**

A: 检查以下几点：
1. Anchors 设置是否正确？
2. 父控件类型是否合适？
3. Size To Content 是否启用？
4. Padding 和 Margin 是否正确？

### 9.2 最佳实践

1. **合理组织 Widget 结构**：
   - 使用清晰的命名
   - 合理嵌套 Widget
   - 避免过深的层级

2. **使用 Widget 蓝图继承**：
   - 创建基础 Widget 类
   - 其他 Widget 继承基础类
   - 减少重复代码

3. **响应式设计**：
   - 使用 Anchors 实现响应式布局
   - 测试不同屏幕尺寸
   - 考虑不同分辨率

4. **性能考虑**：
   - 避免在 Tick 中更新 UI
   - 使用事件驱动
   - 合理使用对象池

5. **用户体验**：
   - 添加适当的动画和过渡
   - 提供视觉反馈
   - 保持界面简洁

## 10. 总结

本文从零开始全面介绍了 UE5 的 UMG UI 系统，包括：

1. **UMG 概述**：核心概念和工作流程
2. **基础控件**：常用控件类型和属性
3. **创建 Widget**：Widget Blueprint 的使用
4. **代码集成**：在 C++ 中创建和使用 Widget
5. **布局系统**：布局控件和响应式设计
6. **动画和过渡**：Widget 动画的使用
7. **实际应用**：HUD、对话框、设置菜单等场景
8. **性能优化**：Widget 性能、渲染、内存优化
9. **最佳实践**：常见问题的解决方案和开发建议

UMG UI 系统是 UE5 游戏开发的重要组成部分，掌握它能够创建各种游戏界面。通过本文的学习，你应该能够：

- 理解 UMG 的核心概念
- 创建和使用 Widget Blueprint
- 在代码中创建和控制 Widget
- 实现响应式布局
- 添加动画和过渡效果
- 创建常见的游戏 UI
- 优化 UI 性能
- 解决常见的 UI 问题

希望这篇文章能帮助你快速掌握 UE5 的 UMG UI 系统！
