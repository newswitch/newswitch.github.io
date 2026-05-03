---
title: UE5学习（一）输入系统
date: 2026-02-24 12:00:00
categories: UE5
tags: [UE5, Unreal Engine, 输入系统, Enhanced Input, 游戏开发]
---

# UE5学习（一）输入系统

> 本文是 UE5 学习系列的第一篇，面向刚开始接触 UE5 的开发者。我们将从零开始，深入理解 UE5 输入系统的原理，并通过完整的代码示例学会如何使用。

## 1. 输入系统概述

### 1.1 什么是输入系统

在游戏开发中，输入系统负责处理玩家通过各种输入设备（键盘、鼠标、手柄、触摸屏等）产生的输入信号，并将这些信号转换为游戏中的动作。UE5 提供了两套输入系统：

1. **传统输入系统（Legacy Input System）**：UE4 及之前版本使用的输入系统
2. **增强型输入系统（Enhanced Input System）**：UE5 引入的新输入系统

### 1.2 为什么需要新的输入系统

传统输入系统存在以下局限性：

- **输入映射不够灵活**：按键绑定是硬编码的，难以动态调整
- **难以处理复杂输入逻辑**：不支持输入修饰符、触发器等功能
- **对不同输入设备的支持有限**：需要为每种设备单独配置
- **难以实现上下文相关的输入处理**：无法根据游戏状态切换不同的输入映射

增强型输入系统解决了这些问题，提供了更强大、更灵活的输入处理能力。

### 1.3 输入系统的工作流程

理解输入系统的工作流程有助于我们更好地使用它：

```
输入设备（键盘/鼠标/手柄）
    ↓
操作系统捕获输入事件
    ↓
UE5 输入系统接收事件
    ↓
Input Mapping Context 映射到 Input Action
    ↓
Input Modifier 修改输入值（可选）
    ↓
Input Trigger 判断是否触发（可选）
    ↓
执行绑定的函数（C++/蓝图）
```

## 2. 增强型输入系统核心概念

### 2.1 Input Action（输入动作）

**Input Action** 是输入系统的核心概念之一。它定义了玩家可以执行的**抽象动作**，而不是具体的按键。

**特点：**
- Input Action 是抽象的，不直接绑定到按键
- 一个 Input Action 可以映射到多个不同的按键（例如：跳跃可以用空格键或手柄的 A 键）
- Input Action 有类型：`Digital`（数字，如按下/释放）、`Axis1D`（一维轴，如鼠标滚轮）、`Axis2D`（二维轴，如 WASD 移动）、`Axis3D`（三维轴，较少使用）

**示例：**
- `IA_Jump`：跳跃动作
- `IA_Move`：移动动作（2D 轴）
- `IA_Look`：视角转动（2D 轴）
- `IA_Attack`：攻击动作

### 2.2 Input Mapping Context（输入映射上下文）

**Input Mapping Context** 是连接**具体按键**和**抽象动作**的桥梁。它定义了一个"映射表"，告诉系统"当玩家按下某个按键时，应该触发哪个 Input Action"。

#### 2.2.1 通俗理解

可以把 Input Mapping Context 想象成一本"按键翻译字典"：

- **Input Action** 是"动作名称"（例如：跳跃、移动、攻击）
- **Input Mapping Context** 是"翻译字典"，告诉你"按空格键 = 跳跃"、"按 W 键 = 向前移动"
- 不同的游戏状态需要不同的"字典"（例如：菜单状态下的 E 键是"打开背包"，游戏状态下是"交互"）

#### 2.2.2 核心作用

**Input Mapping Context 的核心作用是将物理按键映射到逻辑动作。**

具体来说：

1. **提供映射关系**：
   - 在 Input Mapping Context 中，你可以创建多个映射
   - 每个映射包含：按键（Key）+ Input Action + 可选的 Modifier 和 Trigger
   - 例如：`W 键 → IA_Move`、`Space 键 → IA_Jump`

2. **支持上下文切换**：
   - 一个项目可以有多个 Input Mapping Context
   - 根据游戏状态激活不同的上下文
   - 例如：菜单界面使用 `IMC_Menu`，游戏内使用 `IMC_Gameplay`

3. **优先级管理**：
   - 每个上下文有优先级（Priority，数字越大优先级越高）
   - 当多个上下文同时激活时，高优先级的映射会先被检查
   - 如果高优先级找到了匹配，就会使用它（除非设置了不消费输入）

#### 2.2.3 工作原理

当玩家按下按键时，系统的工作流程如下：

```
1. 玩家按下 W 键
   ↓
2. Enhanced Input 系统接收输入事件
   ↓
3. 系统查找所有已激活的 Input Mapping Context（按优先级从高到低）
   ↓
4. 在每个上下文中查找：是否有映射使用 W 键？
   ↓
5. 找到匹配：W 键 → IA_Move
   ↓
6. 获取对应的 Input Action：IA_Move
   ↓
7. 应用 Modifier（如果有）：例如缩放移动速度
   ↓
8. 检查 Trigger（如果有）：例如判断是否满足触发条件
   ↓
9. 如果满足条件，触发绑定的函数
```

#### 2.2.4 实际例子

**例子 1：基本映射**

创建一个 `IMC_Gameplay` 上下文，包含以下映射：

- `W 键` → `IA_Move`（2D 轴，Y 轴正向）
- `S 键` → `IA_Move`（2D 轴，Y 轴负向，使用 Negate Modifier）
- `A 键` → `IA_Move`（2D 轴，X 轴负向，使用 Negate Modifier）
- `D 键` → `IA_Move`（2D 轴，X 轴正向）
- `Space 键` → `IA_Jump`（Digital，使用 Pressed Trigger）
- `鼠标左键` → `IA_Attack`（Digital，使用 Pressed Trigger）

这样，当玩家按下 W 键时，系统会找到映射，触发 `IA_Move`，并传递 `(0, 1)` 的向量值（表示向前移动）。

**例子 2：多上下文切换**

假设你有三个上下文：

- `IMC_Menu`（优先级 2）：菜单界面的输入
  - `E 键` → `IA_OpenInventory`（打开背包）
  - `ESC 键` → `IA_CloseMenu`（关闭菜单）

- `IMC_Gameplay`（优先级 1）：游戏内的输入
  - `E 键` → `IA_Interact`（交互）
  - `W 键` → `IA_Move`（移动）

- `IMC_Dialogue`（优先级 0）：对话系统的输入
  - `E 键` → `IA_NextDialogue`（下一句对话）

**场景 1：在游戏中**
- 激活 `IMC_Gameplay`
- 按下 E 键 → 触发 `IA_Interact`（交互）

**场景 2：打开菜单**
- 移除 `IMC_Gameplay`，添加 `IMC_Menu`
- 按下 E 键 → 触发 `IA_OpenInventory`（打开背包）

**场景 3：同时激活多个上下文**
- 同时激活 `IMC_Menu`（优先级 2）和 `IMC_Gameplay`（优先级 1）
- 按下 E 键：
  - 先检查 `IMC_Menu`（优先级更高）
  - 找到映射：E 键 → `IA_OpenInventory`
  - 如果 `IA_OpenInventory` 的 `Consume Input` 为 true，则只触发打开背包，不会触发交互
  - 如果 `Consume Input` 为 false，则两个动作都可能被触发

#### 2.2.5 与 Input Action 的关系

**Input Action 和 Input Mapping Context 是分离的：**

- **Input Action** 定义"做什么"（抽象的动作）
- **Input Mapping Context** 定义"怎么做"（具体的按键映射）

**优势：**
- 同一个 Input Action 可以在多个上下文中使用
- 同一个 Input Action 可以映射到不同的按键（例如：跳跃可以用空格键或手柄的 A 键）
- 修改按键映射时，不需要修改 Input Action 或代码

**示例：**
```
IA_Jump（Input Action）
  ↓
在 IMC_Gameplay 中：
  - Space 键 → IA_Jump
  - Gamepad Face Button Bottom（手柄 A 键）→ IA_Jump

在 IMC_Menu 中：
  - Enter 键 → IA_Jump（在菜单中，Enter 键也触发确认，复用 IA_Jump）
```

#### 2.2.6 使用场景总结

**常见使用场景：**

- `IMC_Menu`：菜单界面的输入映射
  - 导航菜单选项
  - 确认/取消操作
  - 打开/关闭子菜单

- `IMC_Gameplay`：游戏内的输入映射
  - 角色移动
  - 攻击/防御
  - 技能释放
  - 交互

- `IMC_Dialogue`：对话系统的输入映射
  - 下一句对话
  - 跳过对话
  - 选择对话选项

- `IMC_Vehicle`：载具驾驶的输入映射
  - 加速/刹车
  - 转向
  - 切换视角

#### 2.2.7 关键要点

1. **Input Mapping Context 是映射表**：它告诉系统"按键 → 动作"的对应关系
2. **支持多上下文**：可以根据游戏状态切换不同的映射
3. **优先级机制**：高优先级的上下文会先被检查
4. **与 Input Action 分离**：映射和动作是独立的，便于管理和复用

### 2.3 Input Modifier（输入修饰符）

**Input Modifier** 用于修改输入值，在输入值传递给绑定的函数之前进行处理。

**常用修饰符：**
- **Negate**：反转输入值（例如：将前进改为后退）
- **Scalar**：缩放输入值（例如：将移动速度乘以 0.5）
- **Swizzle Input Axis Values**：交换轴的值（例如：将 X 和 Y 交换）
- **Dead Zone**：设置死区（忽略小的输入值，避免摇杆漂移）

**示例：**
- 反转 Y 轴：使用 Negate 修饰符
- 降低移动灵敏度：使用 Scalar 修饰符，设置缩放值为 0.8

### 2.4 Input Trigger（输入触发器）

**Input Trigger** 决定何时触发 Input Action。

**常用触发器：**
- **Pressed**：按下时触发一次
- **Released**：释放时触发一次
- **Hold**：按住时持续触发
- **Tap**：快速点击时触发（可以设置时间阈值）
- **Pulse**：按固定间隔触发（例如：每 0.5 秒触发一次）
- **Chorded Action**：组合键触发（例如：Ctrl+C）

**示例：**
- 跳跃：使用 Pressed 触发器
- 持续攻击：使用 Hold 触发器
- 冲刺：使用 Tap 触发器（快速双击）

## 3. 项目设置

在使用增强型输入系统之前，需要先在项目设置中启用它。

### 3.1 启用 Enhanced Input

1. 打开项目设置：`Edit > Project Settings`
2. 导航到 `Engine > Input`
3. 设置以下选项：
   - **Default Player Input Class**：设置为 `Enhanced Player Input`
   - **Default Input Component Class**：设置为 `Enhanced Input Component`

### 3.2 验证设置

设置完成后，重启编辑器。如果设置正确，你可以在内容浏览器中创建 Input Action 和 Input Mapping Context。

## 4. 创建输入资源

### 4.1 创建 Input Action

1. 在内容浏览器中右键点击
2. 选择 `Input > Input Action`
3. 命名并创建（建议使用 `IA_` 前缀，例如：`IA_Jump`、`IA_Move`）

**Input Action 属性：**
- **Value Type**：选择输入类型（Digital、Axis1D、Axis2D、Axis3D）
- **Consume Input**：是否消费输入（如果为 true，低优先级的上下文不会收到这个输入）

### 4.2 创建 Input Mapping Context

1. 在内容浏览器中右键点击
2. 选择 `Input > Input Mapping Context`
3. 命名并创建（建议使用 `IMC_` 前缀，例如：`IMC_Default`）

### 4.3 配置 Input Mapping Context

1. 打开创建的 Input Mapping Context
2. 点击 `Mappings` 区域的 `+` 按钮添加映射
3. 为每个映射设置：
   - **Action**：选择对应的 Input Action
   - **Key**：选择按键（例如：W、Space、Gamepad Face Button Bottom）
   - **Modifiers**：添加输入修饰符（可选）
   - **Triggers**：添加输入触发器（可选）

**示例配置：**
- `IA_Move` → W/A/S/D 键（Axis2D，使用 WASD 映射）
- `IA_Jump` → Space 键（Digital，使用 Pressed 触发器）
- `IA_Attack` → 鼠标左键（Digital，使用 Pressed 触发器）

## 5. C++ 代码实现

### 5.1 头文件声明

首先，在 Character 类的头文件中声明必要的变量和函数：

```cpp
// MyCharacter.h

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "MyCharacter.generated.h"

class UInputMappingContext;
class UInputAction;

UCLASS()
class MYGAME_API AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    AMyCharacter();

protected:
    virtual void BeginPlay() override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    // Input Actions
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* JumpAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* MoveAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* LookAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* AttackAction;

    // Input Mapping Context
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputMappingContext* DefaultMappingContext;

    // 输入处理函数
    void Jump(const FInputActionValue& Value);
    void Move(const FInputActionValue& Value);
    void Look(const FInputActionValue& Value);
    void Attack(const FInputActionValue& Value);
};
```

### 5.2 实现文件

在 `.cpp` 文件中实现这些函数：

```cpp
// MyCharacter.cpp

#include "MyCharacter.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/InputComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/Controller.h"
#include "GameFramework/SpringArmComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"

AMyCharacter::AMyCharacter()
{
    PrimaryActorTick.bCanEverTick = true;

    // 设置默认值
    GetCapsuleComponent()->SetCapsuleHalfHeight(88.0f);
    GetCapsuleComponent()->SetCapsuleRadius(34.0f);

    // 设置移动速度
    GetCharacterMovement()->MaxWalkSpeed = 600.0f;
    GetCharacterMovement()->JumpZVelocity = 600.0f;
    GetCharacterMovement()->AirControl = 0.35f;
}

void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();

    // 添加 Input Mapping Context
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            // 清除可能存在的旧映射
            Subsystem->ClearAllMappings();
            
            // 添加新的映射上下文，优先级为 0
            if (DefaultMappingContext)
            {
                Subsystem->AddMappingContext(DefaultMappingContext, 0);
            }
        }
    }
}

void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    // 获取 Enhanced Input Component
    if (UEnhancedInputComponent* EnhancedInputComponent = 
        Cast<UEnhancedInputComponent>(PlayerInputComponent))
    {
        // 绑定 Jump Action
        if (JumpAction)
        {
            EnhancedInputComponent->BindAction(
                JumpAction, 
                ETriggerEvent::Triggered, 
                this, 
                &AMyCharacter::Jump
            );
        }

        // 绑定 Move Action
        if (MoveAction)
        {
            EnhancedInputComponent->BindAction(
                MoveAction, 
                ETriggerEvent::Triggered, 
                this, 
                &AMyCharacter::Move
            );
        }

        // 绑定 Look Action
        if (LookAction)
        {
            EnhancedInputComponent->BindAction(
                LookAction, 
                ETriggerEvent::Triggered, 
                this, 
                &AMyCharacter::Look
            );
        }

        // 绑定 Attack Action
        if (AttackAction)
        {
            EnhancedInputComponent->BindAction(
                AttackAction, 
                ETriggerEvent::Triggered, 
                this, 
                &AMyCharacter::Attack
            );
        }
    }
}

void AMyCharacter::Jump(const FInputActionValue& Value)
{
    // Enhanced Input 的 Jump 函数会处理数字输入
    // 但我们也可以在这里添加自定义逻辑
    ACharacter::Jump();
}

void AMyCharacter::Move(const FInputActionValue& Value)
{
    // 获取 2D 移动向量
    FVector2D MovementVector = Value.Get<FVector2D>();

    if (Controller != nullptr)
    {
        // 获取控制器的旋转（只使用 Yaw，忽略 Pitch 和 Roll）
        const FRotator Rotation = Controller->GetControlRotation();
        const FRotator YawRotation(0, Rotation.Yaw, 0);

        // 计算前进和右方向向量
        const FVector ForwardDirection = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
        const FVector RightDirection = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);

        // 应用移动
        AddMovementInput(ForwardDirection, MovementVector.Y);
        AddMovementInput(RightDirection, MovementVector.X);
    }
}

void AMyCharacter::Look(const FInputActionValue& Value)
{
    // 获取 2D 视角转动向量
    FVector2D LookAxisVector = Value.Get<FVector2D>();

    if (Controller != nullptr)
    {
        // 添加 Yaw 输入（左右转动）
        AddControllerYawInput(LookAxisVector.X);

        // 添加 Pitch 输入（上下转动）
        AddControllerPitchInput(LookAxisVector.Y);
    }
}

void AMyCharacter::Attack(const FInputActionValue& Value)
{
    // 攻击逻辑
    UE_LOG(LogTemp, Warning, TEXT("Attack!"));
    
    // 这里可以添加实际的攻击逻辑
    // 例如：播放攻击动画、生成攻击判定、造成伤害等
}
```

### 5.3 关键代码解析

#### 5.3.1 BeginPlay 中的映射上下文设置

```cpp
if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
    ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
{
    Subsystem->AddMappingContext(DefaultMappingContext, 0);
}
```

这段代码的作用：
- 获取 Enhanced Input 的本地玩家子系统
- 添加输入映射上下文，优先级为 0（数字越大优先级越高）

#### 5.3.2 绑定 Input Action

```cpp
EnhancedInputComponent->BindAction(
    JumpAction,                    // Input Action
    ETriggerEvent::Triggered,     // 触发事件
    this,                          // 目标对象
    &AMyCharacter::Jump           // 绑定的函数
);
```

**ETriggerEvent 枚举值：**
- `Triggered`：触发时（根据 Input Trigger 的设置）
- `Started`：开始触发
- `Ongoing`：持续触发
- `Canceled`：取消触发
- `Completed`：完成触发

#### 5.3.3 获取输入值

```cpp
// 对于 Digital 类型
bool bValue = Value.Get<bool>();

// 对于 Axis1D 类型
float Value = Value.Get<float>();

// 对于 Axis2D 类型
FVector2D Vector = Value.Get<FVector2D>();

// 对于 Axis3D 类型
FVector Vector = Value.Get<FVector>();
```

## 6. 蓝图实现

如果你更喜欢使用蓝图，也可以完全在蓝图中实现输入系统。

### 6.1 在蓝图中设置

1. 打开你的 Character 蓝图
2. 在 `Event BeginPlay` 中：
   - 获取 `Enhanced Input Local Player Subsystem`
   - 调用 `Add Mapping Context`，传入你的 Input Mapping Context

3. 在 `Event Setup Player Input Component` 中：
   - 获取 `Enhanced Input Component`
   - 对于每个 Input Action，调用 `Bind Action`：
     - Action：选择对应的 Input Action
     - Event：选择 `Triggered`
     - Target：选择 `Self`
     - Function：选择或创建处理函数

### 6.2 蓝图函数示例

创建一个蓝图函数来处理移动输入：

1. 函数名：`Move`
2. 参数：`Value`（类型：`Input Action Value`）
3. 实现：
   - 从 `Value` 中获取 `Vector 2D`
   - 使用 `Get Control Rotation` 获取控制器旋转
   - 使用 `Get Forward Vector` 和 `Get Right Vector` 计算方向
   - 调用 `Add Movement Input`

## 7. 高级用法

### 7.1 动态切换输入上下文

在某些情况下，你可能需要根据游戏状态动态切换输入映射：

```cpp
void AMyCharacter::SwitchToMenuInput()
{
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            // 移除游戏内输入映射
            if (GameplayMappingContext)
            {
                Subsystem->RemoveMappingContext(GameplayMappingContext);
            }
            
            // 添加菜单输入映射（更高优先级）
            if (MenuMappingContext)
            {
                Subsystem->AddMappingContext(MenuMappingContext, 1);
            }
        }
    }
}
```

### 7.2 创建自定义 Input Modifier

虽然 UE5 提供了很多内置的 Input Modifier，但有时我们需要自定义的输入修饰逻辑。例如：根据角色状态动态调整移动速度、实现自定义的输入曲线等。

#### 7.2.1 创建自定义 Modifier 的步骤

**步骤 1：创建 C++ 类**

在编辑器中：
1. 右键点击内容浏览器
2. 选择 `C++ Class`
3. 选择 `Input Modifier` 作为父类
4. 命名类（例如：`InputModifier_Smooth`）

**步骤 2：实现 ModifyRaw_Implementation**

这是自定义 Modifier 的核心函数，它会在每帧被调用，用于修改输入值。

#### 7.2.2 示例 1：平滑输入 Modifier

这个 Modifier 会对输入值进行平滑处理，避免输入突然变化：

```cpp
// InputModifier_Smooth.h
#pragma once

#include "CoreMinimal.h"
#include "InputModifiers.h"
#include "InputModifier_Smooth.generated.h"

UCLASS(NotBlueprintable, MinimalAPI, meta = (DisplayName = "Smooth Input"))
class UInputModifier_Smooth : public UInputModifier
{
    GENERATED_BODY()

public:
    // 平滑系数（0-1），值越大越平滑
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings, meta = (ClampMin = "0.0", ClampMax = "1.0"))
    float SmoothingFactor = 0.5f;

protected:
    virtual FInputActionValue ModifyRaw_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue CurrentValue,
        float DeltaTime
    ) override;

private:
    // 存储上一帧的值，用于平滑计算
    FInputActionValue LastValue;
    bool bIsFirstFrame = true;
};

// InputModifier_Smooth.cpp
#include "InputModifier_Smooth.h"
#include "EnhancedPlayerInput.h"

FInputActionValue UInputModifier_Smooth::ModifyRaw_Implementation(
    const UEnhancedPlayerInput* PlayerInput,
    FInputActionValue CurrentValue,
    float DeltaTime
)
{
    if (bIsFirstFrame)
    {
        LastValue = CurrentValue;
        bIsFirstFrame = false;
        return CurrentValue;
    }

    // 根据输入类型进行平滑处理
    EInputActionValueType ValueType = CurrentValue.GetValueType();
    
    switch (ValueType)
    {
        case EInputActionValueType::Boolean:
        {
            // 布尔值直接返回，不进行平滑
            bool bValue = CurrentValue.Get<bool>();
            LastValue = CurrentValue;
            return FInputActionValue(bValue);
        }
        
        case EInputActionValueType::Axis1D:
        {
            // 一维轴：线性插值
            float Current = CurrentValue.Get<float>();
            float Last = LastValue.Get<float>();
            float Smoothed = FMath::Lerp(Last, Current, 1.0f - SmoothingFactor);
            LastValue = FInputActionValue(Smoothed);
            return FInputActionValue(Smoothed);
        }
        
        case EInputActionValueType::Axis2D:
        {
            // 二维轴：分别对 X 和 Y 进行插值
            FVector2D Current = CurrentValue.Get<FVector2D>();
            FVector2D Last = LastValue.Get<FVector2D>();
            FVector2D Smoothed(
                FMath::Lerp(Last.X, Current.X, 1.0f - SmoothingFactor),
                FMath::Lerp(Last.Y, Current.Y, 1.0f - SmoothingFactor)
            );
            LastValue = FInputActionValue(Smoothed);
            return FInputActionValue(Smoothed);
        }
        
        case EInputActionValueType::Axis3D:
        {
            // 三维轴：分别对 X、Y、Z 进行插值
            FVector Current = CurrentValue.Get<FVector>();
            FVector Last = LastValue.Get<FVector>();
            FVector Smoothed(
                FMath::Lerp(Last.X, Current.X, 1.0f - SmoothingFactor),
                FMath::Lerp(Last.Y, Current.Y, 1.0f - SmoothingFactor),
                FMath::Lerp(Last.Z, Current.Z, 1.0f - SmoothingFactor)
            );
            LastValue = FInputActionValue(Smoothed);
            return FInputActionValue(Smoothed);
        }
        
        default:
            return CurrentValue;
    }
}
```

**使用方法：**
1. 编译代码后，在 Input Mapping Context 中
2. 选择对应的映射，添加 Modifier
3. 选择 `Smooth Input`
4. 设置 `Smoothing Factor`（例如：0.3 表示较平滑，0.8 表示较不平滑）

#### 7.2.3 示例 2：基于角色状态的动态缩放 Modifier

这个 Modifier 会根据角色的状态（例如：是否受伤、是否负重）动态调整移动速度：

```cpp
// InputModifier_DynamicScale.h
#pragma once

#include "CoreMinimal.h"
#include "InputModifiers.h"
#include "InputModifier_DynamicScale.generated.h"

UCLASS(NotBlueprintable, MinimalAPI, meta = (DisplayName = "Dynamic Scale"))
class UInputModifier_DynamicScale : public UInputModifier
{
    GENERATED_BODY()

public:
    // 基础缩放值
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings)
    float BaseScale = 1.0f;

    // 是否从角色获取缩放值（如果为 true，会从绑定的角色获取状态）
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings)
    bool bGetScaleFromCharacter = false;

protected:
    virtual FInputActionValue ModifyRaw_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue CurrentValue,
        float DeltaTime
    ) override;
};

// InputModifier_DynamicScale.cpp
#include "InputModifier_DynamicScale.h"
#include "EnhancedPlayerInput.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"

FInputActionValue UInputModifier_DynamicScale::ModifyRaw_Implementation(
    const UEnhancedPlayerInput* PlayerInput,
    FInputActionValue CurrentValue,
    float DeltaTime
)
{
    float FinalScale = BaseScale;

    // 如果启用了从角色获取缩放值
    if (bGetScaleFromCharacter && PlayerInput)
    {
        // 尝试从 PlayerInput 获取拥有者（通常是 Character）
        if (UObject* Owner = PlayerInput->GetOuter())
        {
            if (ACharacter* Character = Cast<ACharacter>(Owner))
            {
                // 根据角色状态调整缩放
                // 例如：如果角色受伤，移动速度降低
                if (Character->GetCharacterMovement())
                {
                    float MaxSpeed = Character->GetCharacterMovement()->MaxWalkSpeed;
                    float DefaultSpeed = 600.0f; // 默认速度
                    FinalScale = BaseScale * (MaxSpeed / DefaultSpeed);
                }
            }
        }
    }

    // 应用缩放
    EInputActionValueType ValueType = CurrentValue.GetValueType();
    
    switch (ValueType)
    {
        case EInputActionValueType::Axis1D:
            return FInputActionValue(CurrentValue.Get<float>() * FinalScale);
        
        case EInputActionValueType::Axis2D:
        {
            FVector2D Value = CurrentValue.Get<FVector2D>();
            return FInputActionValue(Value * FinalScale);
        }
        
        case EInputActionValueType::Axis3D:
        {
            FVector Value = CurrentValue.Get<FVector>();
            return FInputActionValue(Value * FinalScale);
        }
        
        default:
            return CurrentValue;
    }
}
```

#### 7.2.4 在蓝图中使用自定义 Modifier

创建自定义 Modifier 后，它会在编辑器中自动可用：

1. 打开 Input Mapping Context
2. 选择映射，点击 `Modifiers` 的 `+` 按钮
3. 选择你创建的自定义 Modifier
4. 设置 Modifier 的属性

### 7.3 创建自定义 Input Trigger

Input Trigger 决定何时触发 Input Action。虽然 UE5 提供了很多内置的 Trigger，但有时我们需要自定义的触发逻辑。

#### 7.3.1 创建自定义 Trigger 的步骤

**步骤 1：创建 C++ 类**

1. 右键点击内容浏览器
2. 选择 `C++ Class`
3. 选择 `Input Trigger` 作为父类
4. 命名类（例如：`InputTrigger_DoubleTap`）

**步骤 2：实现 UpdateState_Implementation**

这个函数会在每帧被调用，返回当前的触发状态。

**ETriggerState 枚举值：**
- `None`：未触发
- `Ongoing`：正在触发
- `Triggered`：已触发（这一帧触发）

#### 7.3.2 示例 1：双击 Trigger

这个 Trigger 检测快速双击：

```cpp
// InputTrigger_DoubleTap.h
#pragma once

#include "CoreMinimal.h"
#include "InputTriggers.h"
#include "InputTrigger_DoubleTap.generated.h"

UCLASS(NotBlueprintable, MinimalAPI, meta = (DisplayName = "Double Tap"))
class UInputTrigger_DoubleTap : public UInputTrigger
{
    GENERATED_BODY()

public:
    // 两次点击之间的最大时间间隔（秒）
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings, meta = (ClampMin = "0.0"))
    float TapTimeout = 0.3f;

protected:
    virtual ETriggerState UpdateState_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue ModifiedValue,
        float DeltaTime
    ) override;

private:
    // 记录上一次按下的时间
    float LastTapTime = 0.0f;
    
    // 是否已经检测到第一次点击
    bool bFirstTapDetected = false;
    
    // 当前触发状态
    ETriggerState CurrentState = ETriggerState::None;
};

// InputTrigger_DoubleTap.cpp
#include "InputTrigger_DoubleTap.h"
#include "EnhancedPlayerInput.h"

ETriggerState UInputTrigger_DoubleTap::UpdateState_Implementation(
    const UEnhancedPlayerInput* PlayerInput,
    FInputActionValue ModifiedValue,
    float DeltaTime
)
{
    // 获取当前时间
    float CurrentTime = PlayerInput ? PlayerInput->GetOuterAPlayerController()->GetWorld()->GetTimeSeconds() : 0.0f;
    
    // 检查输入值（对于 Digital 类型，true 表示按下）
    bool bIsPressed = false;
    if (ModifiedValue.GetValueType() == EInputActionValueType::Boolean)
    {
        bIsPressed = ModifiedValue.Get<bool>();
    }
    else if (ModifiedValue.GetValueType() == EInputActionValueType::Axis1D)
    {
        bIsPressed = FMath::Abs(ModifiedValue.Get<float>()) > 0.1f;
    }
    else if (ModifiedValue.GetValueType() == EInputActionValueType::Axis2D)
    {
        FVector2D Value = ModifiedValue.Get<FVector2D>();
        bIsPressed = Value.SizeSquared() > 0.01f;
    }

    ETriggerState NewState = ETriggerState::None;

    if (bIsPressed)
    {
        if (!bFirstTapDetected)
        {
            // 第一次按下
            bFirstTapDetected = true;
            LastTapTime = CurrentTime;
            NewState = ETriggerState::None; // 第一次按下不触发
        }
        else
        {
            // 检查是否在时间窗口内
            float TimeSinceLastTap = CurrentTime - LastTapTime;
            if (TimeSinceLastTap <= TapTimeout)
            {
                // 双击成功！
                NewState = ETriggerState::Triggered;
                bFirstTapDetected = false; // 重置，准备下一次双击
            }
            else
            {
                // 超时，重新开始
                LastTapTime = CurrentTime;
                NewState = ETriggerState::None;
            }
        }
    }
    else
    {
        // 按键释放
        if (bFirstTapDetected)
        {
            // 检查是否超时
            float TimeSinceLastTap = CurrentTime - LastTapTime;
            if (TimeSinceLastTap > TapTimeout)
            {
                // 超时，重置
                bFirstTapDetected = false;
            }
        }
        NewState = ETriggerState::None;
    }

    CurrentState = NewState;
    return NewState;
}
```

**使用方法：**
1. 在 Input Mapping Context 中，选择映射
2. 添加 Trigger，选择 `Double Tap`
3. 设置 `Tap Timeout`（例如：0.3 秒）
4. 现在需要快速双击才会触发动作

#### 7.3.3 示例 2：长按 Trigger（带进度反馈）

这个 Trigger 检测长按，并提供进度反馈：

```cpp
// InputTrigger_HoldWithProgress.h
#pragma once

#include "CoreMinimal.h"
#include "InputTriggers.h"
#include "InputTrigger_HoldWithProgress.generated.h"

UCLASS(NotBlueprintable, MinimalAPI, meta = (DisplayName = "Hold With Progress"))
class UInputTrigger_HoldWithProgress : public UInputTrigger
{
    GENERATED_BODY()

public:
    // 需要按住的时间（秒）
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings, meta = (ClampMin = "0.0"))
    float HoldTimeThreshold = 1.0f;

    // 是否在按住期间持续触发（如果为 false，只在达到阈值时触发一次）
    UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = Settings)
    bool bTriggerContinuously = false;

protected:
    virtual ETriggerState UpdateState_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue ModifiedValue,
        float DeltaTime
    ) override;

    // 获取按住进度（0.0 - 1.0）
    UFUNCTION(BlueprintPure, Category = "Input")
    float GetHoldProgress() const { return HoldProgress; }

private:
    // 当前按住的时间
    float CurrentHoldTime = 0.0f;
    
    // 按住进度（0.0 - 1.0）
    float HoldProgress = 0.0f;
    
    // 是否已经触发过
    bool bHasTriggered = false;
};

// InputTrigger_HoldWithProgress.cpp
#include "InputTrigger_HoldWithProgress.h"
#include "EnhancedPlayerInput.h"

ETriggerState UInputTrigger_HoldWithProgress::UpdateState_Implementation(
    const UEnhancedPlayerInput* PlayerInput,
    FInputActionValue ModifiedValue,
    float DeltaTime
)
{
    // 检查输入值
    bool bIsPressed = false;
    if (ModifiedValue.GetValueType() == EInputActionValueType::Boolean)
    {
        bIsPressed = ModifiedValue.Get<bool>();
    }
    else if (ModifiedValue.GetValueType() == EInputActionValueType::Axis1D)
    {
        bIsPressed = FMath::Abs(ModifiedValue.Get<float>()) > 0.1f;
    }

    ETriggerState NewState = ETriggerState::None;

    if (bIsPressed)
    {
        // 累积按住时间
        CurrentHoldTime += DeltaTime;
        HoldProgress = FMath::Clamp(CurrentHoldTime / HoldTimeThreshold, 0.0f, 1.0f);

        // 检查是否达到阈值
        if (CurrentHoldTime >= HoldTimeThreshold)
        {
            if (bTriggerContinuously || !bHasTriggered)
            {
                NewState = ETriggerState::Triggered;
                bHasTriggered = true;
            }
            else
            {
                NewState = ETriggerState::Ongoing;
            }
        }
        else
        {
            NewState = ETriggerState::Ongoing;
        }
    }
    else
    {
        // 按键释放，重置
        CurrentHoldTime = 0.0f;
        HoldProgress = 0.0f;
        bHasTriggered = false;
        NewState = ETriggerState::None;
    }

    return NewState;
}
```

**使用场景：**
- 蓄力攻击：按住攻击键，蓄力时间越长伤害越高
- 充能技能：按住技能键，进度条显示充能进度
- 确认操作：长按确认键，避免误操作

### 7.4 处理复杂输入场景

在实际游戏开发中，我们经常遇到复杂的输入场景。下面介绍几个常见的复杂场景及其解决方案。

#### 7.4.1 场景 1：组合键输入

**需求：** 实现组合键，例如：Ctrl + C（复制）、Shift + 鼠标左键（特殊攻击）

**解决方案：** 使用 `Chorded Action` Trigger

```cpp
// 在 Input Mapping Context 中设置：
// 1. 创建 IA_Copy Action（Digital）
// 2. 创建映射：Ctrl 键 → IA_Copy
// 3. 创建映射：C 键 → IA_Copy，添加 Chorded Action Trigger
//    - 在 Trigger 中设置：Chord Action = IA_Copy（指向 Ctrl 键的映射）
```

**代码实现：**

```cpp
// 在 Character 中
UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputAction* CopyAction;

void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    
    if (UEnhancedInputComponent* EnhancedInputComponent = 
        Cast<UEnhancedInputComponent>(PlayerInputComponent))
    {
        if (CopyAction)
        {
            EnhancedInputComponent->BindAction(
                CopyAction,
                ETriggerEvent::Triggered,
                this,
                &AMyCharacter::OnCopy
            );
        }
    }
}

void AMyCharacter::OnCopy(const FInputActionValue& Value)
{
    UE_LOG(LogTemp, Warning, TEXT("Copy triggered!"));
    // 实现复制逻辑
}
```

#### 7.4.2 场景 2：输入缓冲（Input Buffering）

**需求：** 在角色落地前按下跳跃键，角色落地后自动跳跃（格斗游戏中常见）

**解决方案：** 在代码中实现输入缓冲逻辑

```cpp
// MyCharacter.h
private:
    // 输入缓冲
    bool bJumpBuffered = false;
    float JumpBufferTime = 0.2f; // 缓冲时间
    float JumpBufferTimer = 0.0f;

// MyCharacter.cpp
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 更新跳跃缓冲
    if (bJumpBuffered)
    {
        JumpBufferTimer -= DeltaTime;
        
        // 检查是否可以跳跃
        if (GetCharacterMovement()->IsMovingOnGround())
        {
            ACharacter::Jump();
            bJumpBuffered = false;
            JumpBufferTimer = 0.0f;
        }
        else if (JumpBufferTimer <= 0.0f)
        {
            // 缓冲超时
            bJumpBuffered = false;
        }
    }
}

void AMyCharacter::Jump(const FInputActionValue& Value)
{
    if (GetCharacterMovement()->IsMovingOnGround())
    {
        // 可以立即跳跃
        ACharacter::Jump();
        bJumpBuffered = false;
    }
    else
    {
        // 缓冲跳跃输入
        bJumpBuffered = true;
        JumpBufferTimer = JumpBufferTime;
    }
}
```

#### 7.4.3 场景 3：输入优先级和上下文切换

**需求：** 在游戏中，某些操作应该优先于其他操作（例如：打开菜单应该优先于移动）

**解决方案：** 使用多个 Input Mapping Context 和优先级

```cpp
// MyCharacter.h
UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputMappingContext* GameplayContext;

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputMappingContext* MenuContext;

UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
UInputMappingContext* DialogueContext;

// MyCharacter.cpp
void AMyCharacter::EnterMenuMode()
{
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            // 移除游戏内输入（优先级 1）
            if (GameplayContext)
            {
                Subsystem->RemoveMappingContext(GameplayContext);
            }
            
            // 添加菜单输入（优先级 2，更高）
            if (MenuContext)
            {
                Subsystem->AddMappingContext(MenuContext, 2);
            }
        }
    }
}

void AMyCharacter::ExitMenuMode()
{
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            // 移除菜单输入
            if (MenuContext)
            {
                Subsystem->RemoveMappingContext(MenuContext);
            }
            
            // 恢复游戏内输入
            if (GameplayContext)
            {
                Subsystem->AddMappingContext(GameplayContext, 1);
            }
        }
    }
}
```

#### 7.4.4 场景 4：多设备输入支持

**需求：** 同时支持键盘鼠标和手柄，并且可以无缝切换

**解决方案：** 在同一个 Input Mapping Context 中为每个 Input Action 添加多个映射

```
在 IMC_Gameplay 中：

IA_Move:
  - WASD 键（键盘）
  - 左摇杆（手柄）

IA_Jump:
  - Space 键（键盘）
  - Gamepad Face Button Bottom（手柄 A 键）

IA_Look:
  - 鼠标移动（鼠标）
  - 右摇杆（手柄）
```

Enhanced Input 会自动检测当前使用的输入设备，并使用对应的映射。

#### 7.4.5 场景 5：输入重映射（按键自定义）

**需求：** 允许玩家自定义按键绑定

**解决方案：** 动态修改 Input Mapping Context

```cpp
// MyCharacter.h
UFUNCTION(BlueprintCallable, Category = "Input")
void RebindKey(UInputAction* Action, FKey NewKey);

// MyCharacter.cpp
void AMyCharacter::RebindKey(UInputAction* Action, FKey NewKey)
{
    if (!Action || !DefaultMappingContext)
    {
        return;
    }

    // 查找现有的映射
    TArray<FEnhancedActionKeyMapping>& Mappings = DefaultMappingContext->GetMappings();
    
    for (FEnhancedActionKeyMapping& Mapping : Mappings)
    {
        if (Mapping.Action == Action)
        {
            // 更新按键
            Mapping.Key = NewKey;
            break;
        }
    }

    // 重新应用映射上下文
    if (APlayerController* PlayerController = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = 
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PlayerController->GetLocalPlayer()))
        {
            Subsystem->RemoveMappingContext(DefaultMappingContext);
            Subsystem->AddMappingContext(DefaultMappingContext, 0);
        }
    }
}
```

**在蓝图中使用：**
1. 创建 UI 界面，显示当前按键绑定
2. 玩家点击要修改的按键
3. 等待玩家按下新按键
4. 调用 `RebindKey` 函数

#### 7.4.6 场景 6：输入序列（连招系统）

**需求：** 实现连招系统，例如：轻攻击 → 轻攻击 → 重攻击

**解决方案：** 使用状态机和输入序列检测

```cpp
// MyCharacter.h
private:
    // 连招系统
    TArray<UInputAction*> ComboSequence;
    int32 CurrentComboIndex = 0;
    float ComboWindowTime = 0.5f; // 连招窗口时间
    float ComboTimer = 0.0f;
    bool bComboActive = false;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* LightAttackAction;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = Input)
    UInputAction* HeavyAttackAction;

// MyCharacter.cpp
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();
    
    // 初始化连招序列
    ComboSequence.Add(LightAttackAction);
    ComboSequence.Add(LightAttackAction);
    ComboSequence.Add(HeavyAttackAction);
}

void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 更新连招计时器
    if (bComboActive)
    {
        ComboTimer -= DeltaTime;
        if (ComboTimer <= 0.0f)
        {
            // 连招窗口超时，重置
            ResetCombo();
        }
    }
}

void AMyCharacter::OnLightAttack(const FInputActionValue& Value)
{
    if (bComboActive && CurrentComboIndex < ComboSequence.Num())
    {
        if (ComboSequence[CurrentComboIndex] == LightAttackAction)
        {
            // 匹配连招序列
            CurrentComboIndex++;
            ComboTimer = ComboWindowTime;
            
            if (CurrentComboIndex >= ComboSequence.Num())
            {
                // 连招完成
                ExecuteCombo();
                ResetCombo();
            }
        }
        else
        {
            // 不匹配，重置
            ResetCombo();
        }
    }
    else
    {
        // 开始新的连招
        StartCombo();
    }
    
    // 执行轻攻击
    PerformLightAttack();
}

void AMyCharacter::OnHeavyAttack(const FInputActionValue& Value)
{
    if (bComboActive && CurrentComboIndex < ComboSequence.Num())
    {
        if (ComboSequence[CurrentComboIndex] == HeavyAttackAction)
        {
            // 匹配连招序列
            CurrentComboIndex++;
            
            if (CurrentComboIndex >= ComboSequence.Num())
            {
                // 连招完成
                ExecuteCombo();
                ResetCombo();
            }
        }
        else
        {
            // 不匹配，重置
            ResetCombo();
        }
    }
    
    // 执行重攻击
    PerformHeavyAttack();
}

void AMyCharacter::StartCombo()
{
    bComboActive = true;
    CurrentComboIndex = 0;
    ComboTimer = ComboWindowTime;
}

void AMyCharacter::ResetCombo()
{
    bComboActive = false;
    CurrentComboIndex = 0;
    ComboTimer = 0.0f;
}

void AMyCharacter::ExecuteCombo()
{
    UE_LOG(LogTemp, Warning, TEXT("Combo executed!"));
    // 执行连招效果（例如：播放特殊动画、造成额外伤害等）
}
```

## 8. 常见问题与最佳实践

### 8.1 常见问题

**Q: 输入没有响应怎么办？**

A: 检查以下几点：
1. 项目设置中是否启用了 Enhanced Input
2. Input Mapping Context 是否正确添加到子系统
3. Input Action 的类型是否匹配（例如：移动应该使用 Axis2D）
4. 绑定的函数是否正确实现

**Q: 如何支持多个输入设备？**

A: 在 Input Mapping Context 中，可以为同一个 Input Action 添加多个映射，分别映射到不同的设备按键。Enhanced Input 会自动处理设备切换。

**Q: 如何实现输入缓冲？**

A: 可以在 Input Trigger 中使用 `Chorded Action`，或者在自己的代码中实现输入缓冲逻辑。

### 8.2 最佳实践

1. **命名规范**：
   - Input Action 使用 `IA_` 前缀
   - Input Mapping Context 使用 `IMC_` 前缀
   - 使用清晰的命名，例如：`IA_Jump`、`IA_Move`

2. **组织资源**：
   - 在内容浏览器中创建专门的文件夹组织输入资源
   - 例如：`Input/Actions`、`Input/Contexts`

3. **性能考虑**：
   - 避免在输入处理函数中执行耗时操作
   - 使用事件驱动的方式处理输入

4. **可访问性**：
   - 考虑为不同输入设备提供相同的功能
   - 允许玩家自定义按键绑定

## 9. 总结

本文从零开始全面介绍了 UE5 的增强型输入系统，包括：

1. **核心概念**：Input Action、Input Mapping Context、Input Modifier、Input Trigger 的详细说明
2. **项目设置**：如何启用 Enhanced Input
3. **资源创建**：如何创建和配置输入资源
4. **代码实现**：完整的 C++ 代码示例，包括移动、视角、跳跃、攻击等基础功能
5. **蓝图实现**：在蓝图中使用输入系统的方法
6. **高级特性**：
   - 动态切换输入上下文
   - 创建自定义 Input Modifier（平滑输入、动态缩放等）
   - 创建自定义 Input Trigger（双击、长按等）
   - 处理复杂输入场景（组合键、输入缓冲、输入重映射、连招系统等）
7. **最佳实践**：常见问题的解决方案和开发建议

增强型输入系统为 UE5 游戏开发提供了强大而灵活的输入处理能力。通过合理使用这些功能，你可以创建出响应迅速、易于扩展的输入系统。

**关键要点回顾：**

- **Input Action** 定义"做什么"（抽象动作）
- **Input Mapping Context** 定义"怎么做"（按键映射）
- **Input Modifier** 修改输入值（缩放、反转等）
- **Input Trigger** 决定何时触发（按下、释放、长按等）
- 支持多上下文切换，通过优先级管理输入处理顺序
- 可以创建自定义的 Modifier 和 Trigger 实现特殊需求
- 通过合理的架构设计，可以处理各种复杂的输入场景

掌握了这些知识后，你应该能够：
- 在项目中正确设置和使用 Enhanced Input
- 创建和管理输入资源
- 实现基础的输入功能（移动、视角、跳跃等）
- 创建自定义的输入修饰符和触发器
- 处理复杂的输入场景（组合键、输入缓冲、连招等）

希望这篇文章能帮助你快速上手 UE5 的输入系统，并在实际项目中灵活运用！
