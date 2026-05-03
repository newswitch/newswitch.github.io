---
title: UE5学习（二）射线检测
date: 2026-02-24 12:00:00
categories: UE5
tags: [UE5, Unreal Engine, 射线检测, Line Trace, Raycast, 游戏开发]
---

# UE5学习（二）射线检测

> 本文是 UE5 学习系列的第二篇，面向刚开始接触 UE5 的开发者。我们将从零开始，深入理解 UE5 射线检测的原理，并通过完整的代码示例学会如何使用。

## 1. 射线检测概述

### 1.1 什么是射线检测

**射线检测（Raycast/Line Trace）** 是游戏开发中非常重要的技术，用于检测空间中两点之间是否存在碰撞，或者检测某个方向上的物体。

**通俗理解：**
想象你拿着一根激光笔，从 A 点射向 B 点。射线检测就是检查这根"激光"在路径上是否碰到了什么东西，如果碰到了，还能告诉你碰到了什么、在哪里碰到的。

### 1.2 为什么需要射线检测

射线检测在游戏开发中有很多实际应用：

1. **武器系统**：
   - 检测子弹是否命中目标
   - 计算射击距离和伤害衰减

2. **交互系统**：
   - 检测玩家看向什么物体（例如：门、宝箱、NPC）
   - 显示交互提示（"按 E 打开"）

3. **移动系统**：
   - 检测地面，判断是否可以行走
   - 检测墙壁，避免穿墙
   - 检测台阶，实现自动攀爬

4. **AI 系统**：
   - AI 检测玩家是否在视野内
   - 检测障碍物，规划路径

5. **物理系统**：
   - 检测物体之间的碰撞
   - 实现抓取、投掷等功能

### 1.3 射线检测的工作原理

UE5 的射线检测系统基于物理引擎（PhysX/Chaos），工作流程如下：

```
1. 定义射线的起点和终点（或起点和方向）
   ↓
2. 物理引擎沿着射线路径进行检测
   ↓
3. 检查路径上是否有碰撞体（Collision）
   ↓
4. 如果有碰撞，返回碰撞信息：
   - 碰撞的物体（Hit Actor）
   - 碰撞点位置（Hit Location）
   - 碰撞法线（Hit Normal）
   - 碰撞距离（Distance）
   ↓
5. 如果没有碰撞，返回未命中
```

### 1.4 射线检测的类型

UE5 提供了多种射线检测类型，适用于不同的场景：

1. **Line Trace（直线检测）**：
   - 最简单的检测，从起点到终点画一条直线
   - 适用于：射击、视线检测

2. **Sphere Trace（球形检测）**：
   - 沿着路径移动一个球体进行检测
   - 适用于：更宽松的碰撞检测、拾取物品

3. **Box Trace（盒形检测）**：
   - 沿着路径移动一个盒子进行检测
   - 适用于：检测特定形状的物体

4. **Capsule Trace（胶囊形检测）**：
   - 沿着路径移动一个胶囊体进行检测
   - 适用于：角色移动检测、AI 路径检测

5. **Sweep（扫描检测）**：
   - 移动一个形状进行检测
   - 适用于：物理模拟、移动预测

## 2. 基础概念

### 2.1 碰撞通道（Collision Channel）

**碰撞通道**定义了哪些物体可以被射线检测到。UE5 预定义了多个碰撞通道：

- **WorldStatic**：静态世界几何体（墙壁、地面等）
- **WorldDynamic**：动态世界物体（可移动的物体）
- **Pawn**：角色
- **Visibility**：可见性检测
- **Camera**：摄像机
- **PhysicsBody**：物理体
- **Vehicle**：载具
- **Destructible**：可破坏物体

**使用场景：**
- 射击检测：通常使用 `Visibility` 或 `Pawn` 通道
- 地面检测：使用 `WorldStatic` 通道
- 交互检测：使用自定义通道

### 2.2 碰撞响应（Collision Response）

**碰撞响应**定义了物体对不同类型的检测如何响应：

- **Ignore**：忽略（不检测）
- **Overlap**：重叠（检测但不阻挡）
- **Block**：阻挡（检测并阻挡）

**示例：**
- 子弹检测：需要 `Block` 响应才能检测到命中
- 触发器检测：使用 `Overlap` 响应
- 某些物体：设置为 `Ignore` 以跳过检测

### 2.3 碰撞信息（Hit Result）

射线检测成功后会返回 `FHitResult` 结构体，包含以下信息：

- **`HitActor`**：被击中的 Actor
- **`HitComponent`**：被击中的组件
- **`HitLocation`**：碰撞点的世界坐标
- **`HitNormal`**：碰撞点的法线向量
- **`Distance`**：从起点到碰撞点的距离
- **`Time`**：碰撞点在射线上的参数化位置（0-1）
- **`BoneName`**：如果击中骨骼网格，返回骨骼名称
- **`Material`**：被击中的材质

## 3. 基础使用

### 3.1 Line Trace（直线检测）

**Line Trace** 是最常用的射线检测类型。

#### 3.1.1 最简单的 Line Trace

```cpp
// MyCharacter.h
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Engine/Engine.h"
#include "DrawDebugHelpers.h"
#include "MyCharacter.generated.h"

UCLASS()
class MYGAME_API AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    AMyCharacter();

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // 执行射线检测的函数
    void PerformLineTrace();
};
```

```cpp
// MyCharacter.cpp
#include "MyCharacter.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Kismet/KismetSystemLibrary.h"

AMyCharacter::AMyCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
}

void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();
}

void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 每帧执行射线检测
    PerformLineTrace();
}

void AMyCharacter::PerformLineTrace()
{
    // 获取摄像机位置和方向
    FVector StartLocation;
    FRotator StartRotation;
    
    if (APlayerController* PC = Cast<APlayerController>(GetController()))
    {
        PC->GetPlayerViewPoint(StartLocation, StartRotation);
    }
    else
    {
        // 如果没有控制器，使用角色的位置
        StartLocation = GetActorLocation();
        StartRotation = GetActorRotation();
    }
    
    // 计算终点（向前 1000 单位）
    FVector EndLocation = StartLocation + (StartRotation.Vector() * 1000.0f);
    
    // 执行 Line Trace
    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this); // 忽略自己
    
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Visibility, // 使用 Visibility 通道
        QueryParams
    );
    
    // 绘制调试线
    FColor LineColor = bHit ? FColor::Green : FColor::Red;
    DrawDebugLine(
        GetWorld(),
        StartLocation,
        bHit ? HitResult.Location : EndLocation,
        LineColor,
        false, // 不持久化
        0.0f,  // 生命周期
        0,     // 深度优先级
        2.0f   // 线宽
    );
    
    // 如果命中，绘制碰撞点
    if (bHit)
    {
        DrawDebugSphere(
            GetWorld(),
            HitResult.Location,
            10.0f,
            12,
            FColor::Yellow,
            false,
            0.0f
        );
        
        // 打印碰撞信息
        if (HitResult.GetActor())
        {
            UE_LOG(LogTemp, Warning, TEXT("Hit: %s"), *HitResult.GetActor()->GetName());
        }
    }
}
```

#### 3.1.2 使用 Kismet 库函数

**什么是 Kismet？**

Kismet 是 UE5 提供的一套工具库，包含许多常用的游戏开发功能。Kismet 库函数是对底层 API 的封装，提供了更简洁、更易用的接口。

**Kismet 库的主要模块：**

1. **KismetSystemLibrary**：系统级功能（射线检测、对象查找等）
2. **KismetGameplayStatics**：游戏玩法相关功能（生成 Actor、应用伤害等）
3. **KismetMathLibrary**：数学计算函数
4. **KismetStringLibrary**：字符串处理函数
5. **KismetArrayLibrary**：数组操作函数

**Kismet 库函数的优势：**

1. **更简洁的 API**：参数更直观，使用更方便
2. **自动调试可视化**：可以自动绘制调试线，无需手动调用 `DrawDebugLine`
3. **蓝图友好**：这些函数在蓝图中也可以直接使用
4. **统一的接口**：不同检测类型使用相似的参数结构

**两种方法的对比：**

| 特性 | 直接使用 World 函数 | Kismet 库函数 |
|------|-------------------|--------------|
| 代码复杂度 | 较复杂 | 较简单 |
| 性能 | 略快（直接调用） | 略慢（有封装开销，但可忽略） |
| 调试可视化 | 需要手动绘制 | 可自动绘制 |
| 蓝图支持 | 不支持 | 支持 |
| 灵活性 | 更高 | 稍低 |

**选择建议：**
- **初学者**：推荐使用 Kismet 库函数，更简单易用
- **性能敏感场景**：可以使用直接 World 函数
- **需要复杂控制**：使用直接 World 函数
- **需要蓝图支持**：必须使用 Kismet 库函数

UE5 提供了更简洁的 Kismet 库函数：

```cpp
#include "Kismet/KismetSystemLibrary.h"

void AMyCharacter::PerformLineTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    FHitResult HitResult;
    
    // 使用 Kismet 库函数
    bool bHit = UKismetSystemLibrary::LineTraceSingle(
        GetWorld(),
        StartLocation,
        EndLocation,
        UEngineTypes::ConvertToTraceType(ECC_Visibility),
        false, // 不复杂碰撞
        TArray<AActor*>(), // 忽略的 Actor 列表
        EDrawDebugTrace::ForOneFrame, // 绘制调试线
        HitResult,
        true // 忽略自己
    );
    
    if (bHit && HitResult.GetActor())
    {
        UE_LOG(LogTemp, Warning, TEXT("Hit Actor: %s"), *HitResult.GetActor()->GetName());
        UE_LOG(LogTemp, Warning, TEXT("Hit Location: %s"), *HitResult.Location.ToString());
        UE_LOG(LogTemp, Warning, TEXT("Distance: %f"), HitResult.Distance);
    }
}
```

### 3.2 Sphere Trace（球形检测）

**Sphere Trace** 沿着路径移动一个球体进行检测，适用于需要更宽松检测的场景。

```cpp
void AMyCharacter::PerformSphereTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    float SphereRadius = 50.0f; // 球体半径
    
    FHitResult HitResult;
    
    // 执行 Sphere Trace
    bool bHit = UKismetSystemLibrary::SphereTraceSingle(
        GetWorld(),
        StartLocation,
        EndLocation,
        SphereRadius,
        UEngineTypes::ConvertToTraceType(ECC_Visibility),
        false,
        TArray<AActor*>(),
        EDrawDebugTrace::ForOneFrame,
        HitResult,
        true
    );
    
    if (bHit)
    {
        UE_LOG(LogTemp, Warning, TEXT("Sphere Trace Hit: %s"), 
            HitResult.GetActor() ? *HitResult.GetActor()->GetName() : TEXT("None"));
    }
}
```

### 3.3 Box Trace（盒形检测）

**Box Trace** 沿着路径移动一个盒子进行检测。

```cpp
void AMyCharacter::PerformBoxTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    FVector BoxHalfSize(50.0f, 50.0f, 50.0f); // 盒子的一半尺寸
    FRotator BoxRotation = GetActorRotation();
    
    FHitResult HitResult;
    
    // 执行 Box Trace
    bool bHit = UKismetSystemLibrary::BoxTraceSingle(
        GetWorld(),
        StartLocation,
        EndLocation,
        BoxHalfSize,
        BoxRotation,
        UEngineTypes::ConvertToTraceType(ECC_Visibility),
        false,
        TArray<AActor*>(),
        EDrawDebugTrace::ForOneFrame,
        HitResult,
        true
    );
    
    if (bHit)
    {
        UE_LOG(LogTemp, Warning, TEXT("Box Trace Hit: %s"), 
            HitResult.GetActor() ? *HitResult.GetActor()->GetName() : TEXT("None"));
    }
}
```

### 3.4 Capsule Trace（胶囊形检测）

**Capsule Trace** 沿着路径移动一个胶囊体进行检测，常用于角色移动检测。

```cpp
void AMyCharacter::PerformCapsuleTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    float CapsuleRadius = 34.0f; // 胶囊半径
    float CapsuleHalfHeight = 88.0f; // 胶囊半高
    
    FHitResult HitResult;
    
    // 执行 Capsule Trace
    bool bHit = UKismetSystemLibrary::CapsuleTraceSingle(
        GetWorld(),
        StartLocation,
        EndLocation,
        CapsuleRadius,
        CapsuleHalfHeight,
        UEngineTypes::ConvertToTraceType(ECC_Visibility),
        false,
        TArray<AActor*>(),
        EDrawDebugTrace::ForOneFrame,
        HitResult,
        true
    );
    
    if (bHit)
    {
        UE_LOG(LogTemp, Warning, TEXT("Capsule Trace Hit: %s"), 
            HitResult.GetActor() ? *HitResult.GetActor()->GetName() : TEXT("None"));
    }
}
```

## 4. 实际应用场景

### 4.1 场景 1：武器射击系统

实现一个简单的射击系统，检测子弹是否命中目标。

```cpp
// Weapon.h
UCLASS()
class MYGAME_API AWeapon : public AActor
{
    GENERATED_BODY()

public:
    AWeapon();

    // 开火函数
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    void Fire();

    // 伤害值
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon")
    float Damage = 10.0f;

    // 射程
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon")
    float Range = 5000.0f;

protected:
    // 枪口位置组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    USceneComponent* MuzzleLocation;
};

// Weapon.cpp
#include "Weapon.h"
#include "Components/SceneComponent.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/DamageType.h"

AWeapon::AWeapon()
{
    PrimaryActorTick.bCanEverTick = false;

    // 创建根组件
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("RootComponent"));
    
    // 创建枪口位置组件
    MuzzleLocation = CreateDefaultSubobject<USceneComponent>(TEXT("MuzzleLocation"));
    MuzzleLocation->SetupAttachment(RootComponent);
}

void AWeapon::Fire()
{
    if (!GetWorld())
    {
        return;
    }

    // 获取枪口位置和方向
    FVector StartLocation = MuzzleLocation->GetComponentLocation();
    FVector ForwardVector = MuzzleLocation->GetForwardVector();
    FVector EndLocation = StartLocation + (ForwardVector * Range);

    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);
    QueryParams.AddIgnoredActor(GetOwner()); // 忽略武器持有者

    // 执行 Line Trace
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Visibility,
        QueryParams
    );

    // 绘制调试线
    DrawDebugLine(
        GetWorld(),
        StartLocation,
        bHit ? HitResult.Location : EndLocation,
        FColor::Red,
        false,
        1.0f,
        0,
        2.0f
    );

    if (bHit)
    {
        // 检查是否击中了可造成伤害的 Actor
        AActor* HitActor = HitResult.GetActor();
        if (HitActor)
        {
            // 应用伤害
            UGameplayStatics::ApplyDamage(
                HitActor,
                Damage,
                GetInstigatorController(),
                this,
                UDamageType::StaticClass()
            );

            UE_LOG(LogTemp, Warning, TEXT("Hit %s for %f damage"), 
                *HitActor->GetName(), Damage);
        }

        // 在碰撞点生成特效（例如：火花、弹孔等）
        // UGameplayStatics::SpawnEmitterAtLocation(...);
    }
}
```

#### 4.1.1 模拟子弹下坠效果

**问题：** 标准的 Line Trace 是瞬间的，无法模拟子弹在重力作用下的下坠轨迹。

**解决方案：** 使用分段射线检测，沿着抛物线轨迹进行多次检测，模拟子弹下坠。

**实现方法：**

```cpp
// Weapon.h
public:
    // 子弹初速度
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon|Ballistics")
    float BulletVelocity = 2000.0f; // 米/秒

    // 重力加速度（通常使用 -980，即标准重力）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon|Ballistics")
    float Gravity = -980.0f;

    // 检测精度（每段检测的长度）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon|Ballistics")
    float TraceStepSize = 50.0f; // 每 50 单位检测一次

    // 最大检测时间（秒）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Weapon|Ballistics")
    float MaxTraceTime = 5.0f;

    // 带下坠的射击函数
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    void FireWithDrop();

// Weapon.cpp
void AWeapon::FireWithDrop()
{
    if (!GetWorld())
    {
        return;
    }

    // 获取枪口位置和方向
    FVector StartLocation = MuzzleLocation->GetComponentLocation();
    FVector ForwardVector = MuzzleLocation->GetForwardVector();
    
    // 初始速度向量
    FVector InitialVelocity = ForwardVector * BulletVelocity;
    
    // 计算最大射程（基于物理公式）
    float MaxRange = (BulletVelocity * BulletVelocity * FMath::Sin(2.0f * FMath::DegreesToRadians(45.0f))) / FMath::Abs(Gravity);
    
    // 时间步长（根据检测精度计算）
    float TimeStep = TraceStepSize / BulletVelocity;
    
    FVector CurrentLocation = StartLocation;
    FVector CurrentVelocity = InitialVelocity;
    float CurrentTime = 0.0f;
    
    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);
    QueryParams.AddIgnoredActor(GetOwner());
    
    bool bHit = false;
    TArray<FVector> TracePoints; // 用于绘制轨迹
    
    // 分段检测
    while (CurrentTime < MaxTraceTime && !bHit)
    {
        // 计算下一帧的位置（使用物理公式）
        // 位置 = 初始位置 + 初始速度 * 时间 + 0.5 * 重力 * 时间²
        float NextTime = CurrentTime + TimeStep;
        FVector NextLocation = StartLocation + 
            InitialVelocity * NextTime + 
            FVector(0, 0, Gravity) * 0.5f * NextTime * NextTime;
        
        // 执行射线检测
        bHit = GetWorld()->LineTraceSingleByChannel(
            HitResult,
            CurrentLocation,
            NextLocation,
            ECC_Visibility,
            QueryParams
        );
        
        // 保存轨迹点（用于调试可视化）
        TracePoints.Add(CurrentLocation);
        
        if (bHit)
        {
            // 命中目标
            AActor* HitActor = HitResult.GetActor();
            if (HitActor)
            {
                // 计算实际飞行时间，用于伤害衰减等
                float FlightTime = CurrentTime;
                float FlightDistance = FVector::Dist(StartLocation, HitResult.Location);
                
                // 应用伤害（可以根据距离衰减）
                float DistanceDamageMultiplier = FMath::Clamp(1.0f - (FlightDistance / MaxRange), 0.1f, 1.0f);
                float FinalDamage = Damage * DistanceDamageMultiplier;
                
                UGameplayStatics::ApplyDamage(
                    HitActor,
                    FinalDamage,
                    GetInstigatorController(),
                    this,
                    UDamageType::StaticClass()
                );
                
                UE_LOG(LogTemp, Warning, TEXT("Hit %s at distance %f, damage: %f"), 
                    *HitActor->GetName(), FlightDistance, FinalDamage);
            }
            
            // 绘制命中点
            DrawDebugSphere(
                GetWorld(),
                HitResult.Location,
                10.0f,
                12,
                FColor::Red,
                false,
                2.0f
            );
        }
        else
        {
            // 更新当前位置
            CurrentLocation = NextLocation;
            CurrentTime = NextTime;
            
            // 检查是否超出射程
            float DistanceFromStart = FVector::Dist(StartLocation, CurrentLocation);
            if (DistanceFromStart > MaxRange)
            {
                break;
            }
        }
    }
    
    // 绘制轨迹（调试用）
    if (TracePoints.Num() > 1)
    {
        for (int32 i = 0; i < TracePoints.Num() - 1; ++i)
        {
            DrawDebugLine(
                GetWorld(),
                TracePoints[i],
                TracePoints[i + 1],
                bHit ? FColor::Green : FColor::Yellow,
                false,
                2.0f,
                0,
                1.0f
            );
        }
    }
}
```

**优化版本：使用预测轨迹**

如果你知道目标位置，可以先计算抛物线轨迹，然后沿着轨迹检测：

```cpp
// Weapon.h
    // 计算抛物线轨迹并检测
    UFUNCTION(BlueprintCallable, Category = "Weapon")
    void FireAtTarget(FVector TargetLocation);

// Weapon.cpp
void AWeapon::FireAtTarget(FVector TargetLocation)
{
    if (!GetWorld())
    {
        return;
    }

    FVector StartLocation = MuzzleLocation->GetComponentLocation();
    FVector ToTarget = TargetLocation - StartLocation;
    float HorizontalDistance = FVector2D(ToTarget.X, ToTarget.Y).Size();
    float VerticalDistance = ToTarget.Z;
    
    // 计算需要的发射角度（使用物理公式）
    // 这里使用 45 度角作为初始角度，实际可以根据目标距离调整
    float LaunchAngle = 45.0f;
    
    // 计算需要的初速度（基于目标距离和角度）
    // v² = (g * d) / sin(2θ)
    float RequiredVelocity = FMath::Sqrt(
        (FMath::Abs(Gravity) * HorizontalDistance) / 
        FMath::Sin(2.0f * FMath::DegreesToRadians(LaunchAngle))
    );
    
    // 如果计算出的速度太大，使用最大速度
    float ActualVelocity = FMath::Min(RequiredVelocity, BulletVelocity);
    
    // 计算发射方向
    FVector HorizontalDirection = FVector2D(ToTarget.X, ToTarget.Y).GetSafeNormal();
    FVector LaunchDirection = (HorizontalDirection + FVector(0, 0, FMath::Tan(FMath::DegreesToRadians(LaunchAngle)))).GetSafeNormal();
    
    // 使用计算出的方向进行分段检测
    FVector InitialVelocity = LaunchDirection * ActualVelocity;
    
    // ... 后续检测逻辑与 FireWithDrop() 类似
}
```

**方法对比：**

| 方法 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 分段射线检测 | 精确、可控 | 性能开销较大 | 需要精确弹道的游戏 |
| 物理模拟（Projectile） | 真实、性能好 | 需要创建 Actor | 需要可见子弹的游戏 |
| 曲线计算 | 性能最好 | 不够精确 | 快速原型、简单场景 |

**性能优化建议：**

1. **减少检测频率**：增大 `TraceStepSize`，减少检测次数
2. **限制最大时间**：设置合理的 `MaxTraceTime`
3. **使用对象池**：如果频繁射击，考虑使用对象池管理检测
4. **异步检测**：对于非关键路径，可以使用异步检测

**实际应用：**

- **狙击枪**：需要精确计算弹道，考虑风速、距离等因素
- **榴弹发射器**：明显的抛物线轨迹
- **弓箭**：明显的重力下坠效果
- **投掷物**：手雷、飞刀等

### 4.2 场景 2：交互系统

实现一个交互系统，检测玩家看向什么物体，并显示交互提示。

```cpp
// MyCharacter.h
private:
    // 交互距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
    float InteractionDistance = 200.0f;

    // 当前可交互的物体
    UPROPERTY(BlueprintReadOnly, Category = "Interaction")
    AActor* CurrentInteractable = nullptr;

    // 执行交互检测
    void CheckForInteractables();

    // 执行交互
    UFUNCTION(BlueprintCallable, Category = "Interaction")
    void Interact();

// MyCharacter.cpp
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 每帧检测可交互物体
    CheckForInteractables();
}

void AMyCharacter::CheckForInteractables()
{
    // 获取摄像机位置和方向
    FVector StartLocation;
    FRotator StartRotation;
    
    if (APlayerController* PC = Cast<APlayerController>(GetController()))
    {
        PC->GetPlayerViewPoint(StartLocation, StartRotation);
    }
    else
    {
        StartLocation = GetActorLocation();
        StartRotation = GetActorRotation();
    }

    FVector EndLocation = StartLocation + (StartRotation.Vector() * InteractionDistance);

    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);

    // 执行 Line Trace
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Visibility,
        QueryParams
    );

    // 检查是否击中了可交互的物体
    AActor* NewInteractable = nullptr;
    if (bHit)
    {
        AActor* HitActor = HitResult.GetActor();
        
        // 检查 Actor 是否实现了交互接口（这里假设有一个 IInteractable 接口）
        // 实际使用时，你需要创建自己的接口
        if (HitActor && HitActor->Implements<UInteractableInterface>())
        {
            NewInteractable = HitActor;
        }
    }

    // 更新当前可交互物体
    if (NewInteractable != CurrentInteractable)
    {
        CurrentInteractable = NewInteractable;
        
        // 通知 UI 更新交互提示
        // 例如：显示/隐藏"按 E 交互"的提示
        OnInteractableChanged(CurrentInteractable);
    }
}

void AMyCharacter::Interact()
{
    if (CurrentInteractable)
    {
        // 执行交互
        // 这里需要根据你的交互系统实现
        // 例如：调用接口函数
        // IInteractableInterface::Execute_Interact(CurrentInteractable, this);
        
        UE_LOG(LogTemp, Warning, TEXT("Interacting with: %s"), 
            *CurrentInteractable->GetName());
    }
}
```

### 4.3 场景 3：地面检测

实现地面检测，用于判断角色是否可以行走、计算移动方向等。

```cpp
// MyCharacter.h
private:
    // 地面检测距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Movement")
    float GroundCheckDistance = 100.0f;

    // 是否在地面上
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    bool bIsOnGround = false;

    // 地面法线
    UPROPERTY(BlueprintReadOnly, Category = "Movement")
    FVector GroundNormal = FVector::UpVector;

    // 执行地面检测
    void CheckGround();

// MyCharacter.cpp
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 检测地面
    CheckGround();
}

void AMyCharacter::CheckGround()
{
    // 从角色底部向下检测
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation - FVector(0, 0, GroundCheckDistance);

    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);

    // 使用 Capsule Trace 检测地面
    bool bHit = UKismetSystemLibrary::CapsuleTraceSingle(
        GetWorld(),
        StartLocation,
        EndLocation,
        GetCapsuleComponent()->GetScaledCapsuleRadius(),
        GetCapsuleComponent()->GetScaledCapsuleHalfHeight(),
        UEngineTypes::ConvertToTraceType(ECC_WorldStatic),
        false,
        TArray<AActor*>(),
        EDrawDebugTrace::None,
        HitResult,
        true
    );

    bIsOnGround = bHit;
    
    if (bHit)
    {
        GroundNormal = HitResult.Normal;
        
        // 可以根据地面法线调整移动方向
        // 例如：在斜坡上行走时，沿着斜坡方向移动
    }
    else
    {
        GroundNormal = FVector::UpVector;
    }
}
```

### 4.4 场景 4：视线检测（AI 系统）

实现 AI 的视线检测，判断玩家是否在 AI 的视野内。

```cpp
// AIController.h
UCLASS()
class MYGAME_API AMyAIController : public AAIController
{
    GENERATED_BODY()

public:
    // 检测玩家是否在视野内
    UFUNCTION(BlueprintCallable, Category = "AI")
    bool CanSeePlayer();

    // 视野角度
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    float FieldOfView = 90.0f;

    // 视野距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    float SightDistance = 2000.0f;

protected:
    // 获取玩家引用
    AActor* GetPlayerActor();
};

// AIController.cpp
#include "MyAIController.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/Character.h"

AActor* AMyAIController::GetPlayerActor()
{
    // 获取玩家角色
    ACharacter* PlayerCharacter = UGameplayStatics::GetPlayerCharacter(GetWorld(), 0);
    return PlayerCharacter;
}

bool AMyAIController::CanSeePlayer()
{
    AActor* Player = GetPlayerActor();
    if (!Player || !GetPawn())
    {
        return false;
    }

    // 获取 AI 的位置和方向
    FVector AILocation = GetPawn()->GetActorLocation();
    FVector AIDirection = GetPawn()->GetActorForwardVector();
    
    // 获取玩家位置
    FVector PlayerLocation = Player->GetActorLocation();
    
    // 计算到玩家的方向
    FVector ToPlayer = (PlayerLocation - AILocation).GetSafeNormal();
    
    // 检查是否在视野角度内
    float DotProduct = FVector::DotProduct(AIDirection, ToPlayer);
    float CosFOV = FMath::Cos(FMath::DegreesToRadians(FieldOfView / 2.0f));
    
    if (DotProduct < CosFOV)
    {
        // 不在视野角度内
        return false;
    }
    
    // 检查距离
    float Distance = FVector::Dist(AILocation, PlayerLocation);
    if (Distance > SightDistance)
    {
        return false;
    }
    
    // 执行 Line Trace，检查是否有障碍物阻挡
    FHitResult HitResult;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(GetPawn());
    QueryParams.AddIgnoredActor(Player);
    
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        AILocation,
        PlayerLocation,
        ECC_Visibility,
        QueryParams
    );
    
    // 如果没有命中，或者命中的是玩家，说明可以看到玩家
    return !bHit || HitResult.GetActor() == Player;
}
```

## 5. 高级用法

### 5.1 多目标检测（Multi Trace）

有时需要检测路径上的所有物体，而不仅仅是第一个。

```cpp
void AMyCharacter::PerformMultiLineTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);

    TArray<FHitResult> HitResults;
    FCollisionQueryParams QueryParams;
    QueryParams.AddIgnoredActor(this);

    // 执行多目标检测
    bool bHit = GetWorld()->LineTraceMultiByChannel(
        HitResults,
        StartLocation,
        EndLocation,
        ECC_Visibility,
        QueryParams
    );

    if (bHit)
    {
        // 处理所有命中的物体
        for (const FHitResult& Hit : HitResults)
        {
            if (Hit.GetActor())
            {
                UE_LOG(LogTemp, Warning, TEXT("Hit: %s at distance %f"), 
                    *Hit.GetActor()->GetName(), Hit.Distance);
            }
        }
    }
}
```

### 5.2 自定义碰撞通道

创建自定义碰撞通道，用于特定类型的检测。

**步骤：**
1. 打开项目设置：`Edit > Project Settings`
2. 导航到 `Engine > Collision`
3. 在 `Collision` 部分，点击 `New` 创建新通道
4. 命名通道（例如：`Interactable`）
5. 设置默认响应

**在代码中使用：**

```cpp
// 定义自定义通道（通常在项目设置中完成）
// 假设创建了 ECC_Interactable 通道

void AMyCharacter::CheckForInteractables()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * InteractionDistance);

    FHitResult HitResult;
    
    // 使用自定义通道
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Interactable, // 自定义通道
        FCollisionQueryParams()
    );

    // ...
}
```

### 5.3 复杂碰撞检测

使用 `FCollisionQueryParams` 进行更精细的控制。

```cpp
void AMyCharacter::PerformComplexTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);

    FHitResult HitResult;
    
    // 创建查询参数
    FCollisionQueryParams QueryParams;
    
    // 忽略多个 Actor
    QueryParams.AddIgnoredActor(this);
    QueryParams.AddIgnoredActor(SomeOtherActor);
    
    // 使用复杂碰撞（更精确但更慢）
    QueryParams.bTraceComplex = true;
    
    // 查找初始重叠（如果起点在物体内部）
    QueryParams.bFindInitialOverlaps = true;
    
    // 返回物理材质
    QueryParams.bReturnPhysicalMaterial = true;
    
    // 执行检测
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Visibility,
        QueryParams
    );

    if (bHit)
    {
        // 获取物理材质
        if (HitResult.PhysMaterial.IsValid())
        {
            UPhysicalMaterial* PhysMat = HitResult.PhysMaterial.Get();
            UE_LOG(LogTemp, Warning, TEXT("Hit physical material: %s"), 
                *PhysMat->GetName());
        }
    }
}
```

### 5.4 异步射线检测

对于性能敏感的场景，可以使用异步检测。

```cpp
// 注意：UE5 的异步检测通常通过 AsyncTask 实现
// 这里提供一个简化的示例

void AMyCharacter::PerformAsyncTrace()
{
    // 在游戏线程中准备数据
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    // 在实际项目中，你可能需要使用 AsyncTask 或 Task Graph
    // 这里只是展示概念
    // AsyncTask(ENamedThreads::AnyHiPriThreadNormalTask, [=]()
    // {
    //     // 在后台线程执行检测
    //     // 注意：某些操作必须在游戏线程执行
    // });
}
```

## 6. 性能优化

射线检测是游戏开发中常见的性能瓶颈之一。在高频率调用时（例如：每帧多次检测），不当的使用会导致严重的性能问题。本章节将详细介绍如何优化射线检测的性能。

### 6.1 性能优化策略

#### 6.1.1 减少检测频率

**问题描述：**

每帧执行射线检测会消耗大量 CPU 资源，特别是在有大量 Actor 的场景中。如果每帧执行 60 次检测（60 FPS），在复杂场景中可能导致明显的性能问题。例如，一个交互系统如果每帧都检测玩家看向的物体，即使场景中有 100 个物体，每帧也需要检查这 100 个物体，60 帧就是每秒 6000 次检查。

**优化原理：**

大多数游戏功能并不需要每帧都更新。例如，交互检测只需要在玩家移动或视角改变时更新，而不需要每帧都检测。通过降低检测频率，可以大幅减少 CPU 占用，同时保持足够的响应性。

**解决方案：**

**方法 1：使用定时器**

定时器是最常用的降低检测频率的方法。通过设置一个固定的时间间隔（例如：0.1 秒），可以让检测以较低的频率执行，而不是每帧都执行。这种方法适用于需要持续检测但不需要实时更新的场景，如交互检测、地面检测等。

**工作原理：** UE5 的定时器系统会在指定的时间间隔后调用指定的函数，可以设置为循环执行，实现周期性检测。

**优点：** 简单易用，性能开销小，可以精确控制检测频率。

**缺点：** 检测频率固定，无法根据实际情况动态调整。

**适用场景：** 交互检测、地面检测、AI 感知等需要持续但不需要实时更新的功能。

```cpp
// MyCharacter.h
private:
    // 检测间隔（秒）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Performance")
    float TraceInterval = 0.1f; // 每 0.1 秒检测一次（10 FPS）

    FTimerHandle TraceTimerHandle;

    // 执行检测的函数
    void PerformPeriodicTrace();

// MyCharacter.cpp
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();
    
    // 设置定时器，每 TraceInterval 秒执行一次
    GetWorldTimerManager().SetTimer(
        TraceTimerHandle,
        this,
        &AMyCharacter::PerformPeriodicTrace,
        TraceInterval,
        true // 循环执行
    );
}

void AMyCharacter::PerformPeriodicTrace()
{
    // 执行射线检测
    // ...
}
```

**方法 2：事件驱动**

事件驱动是最高效的降低检测频率的方法。只在真正需要时才执行检测，而不是持续检测。例如，武器射击只在玩家按下开火键时检测，交互检测只在玩家移动或视角改变时检测。

**工作原理：** 将检测绑定到特定事件（如输入事件、移动事件），只有当这些事件发生时才执行检测。

**优点：** 性能开销最小，只在需要时执行，完全避免了不必要的检测。

**缺点：** 需要明确知道何时需要检测，不适合需要持续监控的场景。

**适用场景：** 武器射击、点击检测、特定事件触发的检测等。

```cpp
// 只在需要时检测，而不是持续检测
void AMyCharacter::OnInputPressed()
{
    // 只在玩家按下按键时检测
    PerformLineTrace();
}
```

**方法 3：距离阈值**

距离阈值是一种智能的降低检测频率的方法。通过跟踪上次检测的位置，只在玩家移动超过一定距离后才重新检测。这种方法特别适用于与位置相关的检测，如地面检测、环境交互等。

**工作原理：** 记录上次检测时的位置，每次 Tick 时计算当前位置与上次检测位置的距离，如果距离超过阈值，则执行检测并更新记录的位置。

**优点：** 根据实际情况动态调整检测频率，玩家移动快时检测频率高，静止时检测频率低。

**缺点：** 需要额外的存储空间记录位置，实现稍复杂。

**适用场景：** 地面检测、移动相关的环境交互、位置相关的 AI 检测等。

```cpp
// 只在玩家移动一定距离后才重新检测
private:
    FVector LastTraceLocation;
    float TraceDistanceThreshold = 100.0f; // 移动 100 单位后才重新检测

void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 检查是否需要重新检测
    float DistanceMoved = FVector::Dist(GetActorLocation(), LastTraceLocation);
    if (DistanceMoved > TraceDistanceThreshold)
    {
        PerformLineTrace();
        LastTraceLocation = GetActorLocation();
    }
}
```

**性能对比：**

| 方法 | 检测频率 | CPU 占用 | 适用场景 |
|------|---------|---------|---------|
| 每帧检测 | 60 次/秒 | 高 | 需要实时反馈（如瞄准辅助） |
| 定时器（0.1s） | 10 次/秒 | 中 | 交互检测、地面检测 |
| 事件驱动 | 按需 | 低 | 武器射击、点击检测 |
| 距离阈值 | 按需 | 低 | 移动相关的检测 |

#### 6.1.2 使用合适的检测类型

**问题描述：**

不同类型的射线检测（Line Trace、Sphere Trace、Box Trace、Capsule Trace）性能差异很大。Line Trace 是最快的，因为它只需要检测一条直线。而 Sphere Trace、Box Trace、Capsule Trace 需要检测一个体积，计算复杂度更高。在不必要的情况下使用形状检测会浪费大量性能。

**优化原理：**

选择最合适的检测类型可以在保持功能需求的同时最大化性能。如果只需要检测是否命中，Line Trace 就足够了。只有在需要更宽松的检测（如拾取物品、角色移动检测）时才应该使用形状检测。

**性能对比：**

不同类型的射线检测性能差异很大：

```cpp
// 性能测试代码
void AMyCharacter::CompareTracePerformance()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    const int32 NumTests = 1000;
    double StartTime, EndTime;
    
    // 1. Line Trace（最快）
    StartTime = FPlatformTime::Seconds();
    for (int32 i = 0; i < NumTests; ++i)
    {
        FHitResult HitResult;
        GetWorld()->LineTraceSingleByChannel(
            HitResult, StartLocation, EndLocation, ECC_Visibility, FCollisionQueryParams()
        );
    }
    EndTime = FPlatformTime::Seconds();
    UE_LOG(LogTemp, Warning, TEXT("Line Trace: %f ms"), (EndTime - StartTime) * 1000.0);
    
    // 2. Sphere Trace（较慢）
    StartTime = FPlatformTime::Seconds();
    for (int32 i = 0; i < NumTests; ++i)
    {
        FHitResult HitResult;
        UKismetSystemLibrary::SphereTraceSingle(
            GetWorld(), StartLocation, EndLocation, 50.0f, 
            UEngineTypes::ConvertToTraceType(ECC_Visibility),
            false, TArray<AActor*>(), EDrawDebugTrace::None, HitResult, true
        );
    }
    EndTime = FPlatformTime::Seconds();
    UE_LOG(LogTemp, Warning, TEXT("Sphere Trace: %f ms"), (EndTime - StartTime) * 1000.0);
    
    // 3. Box Trace（最慢）
    StartTime = FPlatformTime::Seconds();
    for (int32 i = 0; i < NumTests; ++i)
    {
        FHitResult HitResult;
        UKismetSystemLibrary::BoxTraceSingle(
            GetWorld(), StartLocation, EndLocation, FVector(50, 50, 50), FRotator::ZeroRotator,
            UEngineTypes::ConvertToTraceType(ECC_Visibility),
            false, TArray<AActor*>(), EDrawDebugTrace::None, HitResult, true
        );
    }
    EndTime = FPlatformTime::Seconds();
    UE_LOG(LogTemp, Warning, TEXT("Box Trace: %f ms"), (EndTime - StartTime) * 1000.0);
}
```

**典型性能数据（1000 次检测）：**

- **Line Trace**：~1-5 ms
- **Sphere Trace**：~5-15 ms（比 Line Trace 慢 3-5 倍）
- **Box Trace**：~10-30 ms（比 Line Trace 慢 5-10 倍）
- **Capsule Trace**：~8-20 ms（比 Line Trace 慢 4-8 倍）

**选择建议：**
- 优先使用 **Line Trace**，除非确实需要形状检测
- 需要宽松检测时，考虑先用 Line Trace，如果没命中再用 Sphere Trace
- 避免在高频场景使用 Box Trace

#### 6.1.3 限制检测距离

**问题描述：**

检测距离越远，射线需要检查的物体越多，性能开销越大。例如，检测距离 1000 单位可能需要检查 50 个物体，而检测距离 200 单位可能只需要检查 5 个物体。在大多数情况下，我们并不需要检测非常远的物体。

**优化原理：**

通过限制检测距离，可以减少需要检查的物体数量，从而提升性能。同时，可以根据检测距离动态调整检测频率：近距离时高频检测（需要精确），远距离时低频检测（可以接受延迟）。

**优化方法：**

```cpp
// MyCharacter.h
private:
    // 最大检测距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Performance")
    float MaxTraceDistance = 500.0f; // 限制在 500 单位内

    // 根据距离动态调整检测频率
    float GetTraceIntervalForDistance(float Distance)
    {
        // 距离越远，检测频率越低
        if (Distance < 100.0f)
        {
            return 0.05f; // 近距离：20 FPS
        }
        else if (Distance < 300.0f)
        {
            return 0.1f; // 中距离：10 FPS
        }
        else
        {
            return 0.2f; // 远距离：5 FPS
        }
    }

// MyCharacter.cpp
void AMyCharacter::PerformOptimizedTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector ForwardVector = GetActorForwardVector();
    
    // 限制检测距离
    FVector EndLocation = StartLocation + (ForwardVector * MaxTraceDistance);
    
    FHitResult HitResult;
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Visibility,
        FCollisionQueryParams()
    );
    
    if (bHit)
    {
        float HitDistance = HitResult.Distance;
        
        // 根据命中距离调整后续检测频率
        float NewInterval = GetTraceIntervalForDistance(HitDistance);
        GetWorldTimerManager().SetTimer(
            TraceTimerHandle,
            this,
            &AMyCharacter::PerformOptimizedTrace,
            NewInterval,
            true
        );
    }
}
```

**距离优化效果：**

- 检测距离 1000 单位：~5 ms
- 检测距离 500 单位：~2.5 ms（快 2 倍）
- 检测距离 200 单位：~1 ms（快 5 倍）

#### 6.1.4 使用碰撞通道过滤

**问题描述：**

使用 `ECC_Visibility` 等通用碰撞通道会检测所有可见的物体，包括大量不需要的物体。例如，交互系统只需要检测可交互的物体（门、宝箱、NPC），但使用 `ECC_Visibility` 会检测所有可见物体（墙壁、地面、装饰物等），导致大量不必要的检测。

**优化原理：**

通过创建专用的碰撞通道，可以只检测特定类型的物体，跳过所有不需要的物体。这可以大幅减少需要检查的物体数量，从而提升性能。例如，创建一个 `ECC_Interactable` 通道，只让可交互的物体响应这个通道，交互检测时只检测这个通道，就可以跳过所有其他物体。

**优化方法：**

```cpp
// 创建专用的碰撞通道（在项目设置中）
// 例如：ECC_Interactable、ECC_Enemy、ECC_Projectile

void AMyCharacter::PerformFilteredTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    FHitResult HitResult;
    
    // 使用专用通道，只检测可交互物体
    // 这比使用 ECC_Visibility 快得多，因为跳过了大量不需要的物体
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        StartLocation,
        EndLocation,
        ECC_Interactable, // 专用通道
        FCollisionQueryParams()
    );
}
```

**性能提升：**

- 使用通用通道（ECC_Visibility）：检测所有可见物体，性能开销大
- 使用专用通道（ECC_Interactable）：只检测可交互物体，性能提升 **2-5 倍**

**多通道检测：**

如果需要检测多种类型的物体，可以使用对象类型查询：

```cpp
void AMyCharacter::PerformMultiChannelTrace()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    FHitResult HitResult;
    
    // 使用对象类型查询，可以同时检测多个通道
    FCollisionObjectQueryParams ObjectQueryParams;
    ObjectQueryParams.AddObjectTypesToQuery(ECC_Pawn);      // 检测角色
    ObjectQueryParams.AddObjectTypesToQuery(ECC_WorldStatic); // 检测静态物体
    
    bool bHit = GetWorld()->LineTraceSingleByObjectType(
        HitResult,
        StartLocation,
        EndLocation,
        ObjectQueryParams,
        FCollisionQueryParams()
    );
}
```

#### 6.1.5 避免复杂碰撞

**问题描述：**

UE5 中的碰撞检测有两种模式：简单碰撞（Simple Collision）和复杂碰撞（Complex Collision）。简单碰撞使用简化的碰撞体（如球体、盒子、胶囊体），计算速度快。复杂碰撞使用网格的精确几何体（所有三角形），计算开销非常大，通常比简单碰撞慢 5-15 倍。

**优化原理：**

对于大多数场景，简单碰撞已经足够精确。简单碰撞体通常由美术人员在建模时创建，或者由引擎自动生成。只有在需要精确检测网格细节时（如检测网格上的特定点）才需要使用复杂碰撞。

**性能对比：**

```cpp
void AMyCharacter::CompareCollisionComplexity()
{
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * 1000.0f);
    
    const int32 NumTests = 1000;
    
    // 简单碰撞
    FCollisionQueryParams SimpleParams;
    SimpleParams.bTraceComplex = false; // 使用简单碰撞
    
    double StartTime = FPlatformTime::Seconds();
    for (int32 i = 0; i < NumTests; ++i)
    {
        FHitResult HitResult;
        GetWorld()->LineTraceSingleByChannel(
            HitResult, StartLocation, EndLocation, ECC_Visibility, SimpleParams
        );
    }
    double EndTime = FPlatformTime::Seconds();
    UE_LOG(LogTemp, Warning, TEXT("Simple Collision: %f ms"), (EndTime - StartTime) * 1000.0);
    
    // 复杂碰撞
    FCollisionQueryParams ComplexParams;
    ComplexParams.bTraceComplex = true; // 使用复杂碰撞
    
    StartTime = FPlatformTime::Seconds();
    for (int32 i = 0; i < NumTests; ++i)
    {
        FHitResult HitResult;
        GetWorld()->LineTraceSingleByChannel(
            HitResult, StartLocation, EndLocation, ECC_Visibility, ComplexParams
        );
    }
    EndTime = FPlatformTime::Seconds();
    UE_LOG(LogTemp, Warning, TEXT("Complex Collision: %f ms"), (EndTime - StartTime) * 1000.0);
}
```

**典型性能差异：**

- **简单碰撞**：~1-3 ms（1000 次）
- **复杂碰撞**：~10-50 ms（1000 次，慢 **5-15 倍**）

**使用建议：**
- **默认使用简单碰撞**：对于大多数场景，简单碰撞已经足够精确
- **只在必要时使用复杂碰撞**：例如需要精确检测网格细节时
- **混合使用**：先用简单碰撞快速检测，需要精确结果时再用复杂碰撞

#### 6.1.6 缓存和重用查询参数

**问题描述：**

每次执行射线检测时，如果每次都创建新的 `FCollisionQueryParams` 对象，会有一定的内存分配和初始化开销。虽然这个开销相对较小，但在高频检测场景中，累积起来也会影响性能。

**优化原理：**

如果查询参数在多次检测中保持不变（例如：总是忽略相同的 Actor，总是使用相同的碰撞设置），可以将参数缓存起来，在 `BeginPlay` 时初始化一次，之后重复使用。这样可以避免重复的内存分配和初始化开销。

**优化方法：**

```cpp
// MyCharacter.h
private:
    // 缓存的查询参数
    FCollisionQueryParams CachedQueryParams;
    bool bQueryParamsInitialized = false;

// MyCharacter.cpp
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();
    
    // 初始化查询参数（只执行一次）
    CachedQueryParams.AddIgnoredActor(this);
    CachedQueryParams.bTraceComplex = false;
    bQueryParamsInitialized = true;
}

void AMyCharacter::PerformCachedTrace()
{
    // 重用缓存的参数，避免重复创建
    FHitResult HitResult;
    bool bHit = GetWorld()->LineTraceSingleByChannel(
        HitResult,
        GetActorLocation(),
        GetActorLocation() + (GetActorForwardVector() * 1000.0f),
        ECC_Visibility,
        CachedQueryParams // 重用缓存的参数
    );
}
```

**性能提升：** 减少参数创建开销，提升 **5-10%** 性能。

#### 6.1.7 批量检测优化

**问题描述：**

在某些场景中，需要同时检测多个目标。如果逐个执行检测，每个检测都需要单独的函数调用和参数传递，效率较低。例如，AI 需要检测周围的所有玩家，或者武器需要检测多个可能的命中点。

**优化原理：**

对于在同一直线上的多个检测点，可以使用 `LineTraceMulti` 一次性检测所有点，这比逐个检测更高效。对于不在同一直线上的多个目标，可以考虑使用空间数据结构（如八叉树）进行优化，或者使用并行处理。

**优化方法：**

```cpp
void AMyCharacter::PerformBatchTrace()
{
    FVector StartLocation = GetActorLocation();
    
    // 需要检测的多个目标位置
    TArray<FVector> TargetLocations;
    TargetLocations.Add(StartLocation + FVector(100, 0, 0));
    TargetLocations.Add(StartLocation + FVector(200, 0, 0));
    TargetLocations.Add(StartLocation + FVector(300, 0, 0));
    
    // 方法 1：逐个检测（慢）
    TArray<FHitResult> HitResults;
    for (const FVector& Target : TargetLocations)
    {
        FHitResult HitResult;
        GetWorld()->LineTraceSingleByChannel(
            HitResult, StartLocation, Target, ECC_Visibility, FCollisionQueryParams()
        );
        if (HitResult.bBlockingHit)
        {
            HitResults.Add(HitResult);
        }
    }
    
    // 方法 2：使用 Multi Trace（如果目标在同一直线上，更快）
    // 注意：Multi Trace 只适用于同一直线上的多个点
    TArray<FHitResult> MultiHitResults;
    FVector EndLocation = StartLocation + FVector(1000, 0, 0);
    GetWorld()->LineTraceMultiByChannel(
        MultiHitResults, StartLocation, EndLocation, ECC_Visibility, FCollisionQueryParams()
    );
}
```

### 6.2 性能分析工具

#### 6.2.1 使用 Stat 命令

UE5 提供了内置的性能统计命令：

```cpp
// 在控制台输入以下命令查看性能统计

// 查看物理性能
stat Physics

// 查看碰撞性能
stat Collision

// 查看详细性能
stat Detailed
```

#### 6.2.2 使用 Unreal Insights

Unreal Insights 是 UE5 的性能分析工具，可以详细分析射线检测的性能：

1. 启动 Unreal Insights
2. 开始录制
3. 运行游戏
4. 停止录制
5. 查看 `Collision` 或 `Physics` 相关的性能数据

#### 6.2.3 自定义性能统计

```cpp
// MyCharacter.h
DECLARE_STATS_GROUP(TEXT("MyGame"), STATGROUP_MyGame, STATCAT_Advanced);

DECLARE_CYCLE_STAT(TEXT("LineTrace"), STAT_LineTrace, STATGROUP_MyGame);

// MyCharacter.cpp
void AMyCharacter::PerformTracedWithStats()
{
    SCOPE_CYCLE_COUNTER(STAT_LineTrace); // 开始统计
    
    FHitResult HitResult;
    GetWorld()->LineTraceSingleByChannel(
        HitResult,
        GetActorLocation(),
        GetActorLocation() + (GetActorForwardVector() * 1000.0f),
        ECC_Visibility,
        FCollisionQueryParams()
    );
    
    // 统计自动结束
}
```

在游戏中按 `~` 打开控制台，输入 `stat MyGame` 查看统计信息。

### 6.3 性能测试基准

创建一个完整的性能测试系统：

```cpp
// PerformanceTestActor.h
UCLASS()
class MYGAME_API APerformanceTestActor : public AActor
{
    GENERATED_BODY()

public:
    APerformanceTestActor();

    // 执行性能测试
    UFUNCTION(BlueprintCallable, Category = "Performance")
    void RunPerformanceTests();

protected:
    virtual void BeginPlay() override;

private:
    // 测试配置
    UPROPERTY(EditAnywhere, Category = "Performance")
    int32 NumTests = 1000;

    UPROPERTY(EditAnywhere, Category = "Performance")
    float TraceDistance = 1000.0f;

    // 测试结果
    struct FTestResult
    {
        FString TestName;
        double TotalTime;
        double AverageTime;
        int32 NumHits;
    };

    TArray<FTestResult> TestResults;

    // 执行单个测试
    void RunSingleTest(const FString& TestName, TFunction<void()> TestFunction);
    
    // 打印结果
    void PrintResults();
};

// PerformanceTestActor.cpp
#include "PerformanceTestActor.h"
#include "Kismet/KismetSystemLibrary.h"
#include "DrawDebugHelpers.h"

APerformanceTestActor::APerformanceTestActor()
{
    PrimaryActorTick.bCanEverTick = false;
}

void APerformanceTestActor::BeginPlay()
{
    Super::BeginPlay();
    
    // 自动运行测试（可选）
    // RunPerformanceTests();
}

void APerformanceTestActor::RunPerformanceTests()
{
    TestResults.Empty();
    
    FVector StartLocation = GetActorLocation();
    FVector EndLocation = StartLocation + (GetActorForwardVector() * TraceDistance);
    
    // 测试 1：Line Trace（简单碰撞）
    RunSingleTest(TEXT("Line Trace (Simple)"), [=]()
    {
        FCollisionQueryParams Params;
        Params.bTraceComplex = false;
        
        for (int32 i = 0; i < NumTests; ++i)
        {
            FHitResult HitResult;
            GetWorld()->LineTraceSingleByChannel(
                HitResult, StartLocation, EndLocation, ECC_Visibility, Params
            );
        }
    });
    
    // 测试 2：Line Trace（复杂碰撞）
    RunSingleTest(TEXT("Line Trace (Complex)"), [=]()
    {
        FCollisionQueryParams Params;
        Params.bTraceComplex = true;
        
        for (int32 i = 0; i < NumTests; ++i)
        {
            FHitResult HitResult;
            GetWorld()->LineTraceSingleByChannel(
                HitResult, StartLocation, EndLocation, ECC_Visibility, Params
            );
        }
    });
    
    // 测试 3：Sphere Trace
    RunSingleTest(TEXT("Sphere Trace"), [=]()
    {
        for (int32 i = 0; i < NumTests; ++i)
        {
            FHitResult HitResult;
            UKismetSystemLibrary::SphereTraceSingle(
                GetWorld(), StartLocation, EndLocation, 50.0f,
                UEngineTypes::ConvertToTraceType(ECC_Visibility),
                false, TArray<AActor*>(), EDrawDebugTrace::None, HitResult, true
            );
        }
    });
    
    // 打印结果
    PrintResults();
}

void APerformanceTestActor::RunSingleTest(const FString& TestName, TFunction<void()> TestFunction)
{
    double StartTime = FPlatformTime::Seconds();
    TestFunction();
    double EndTime = FPlatformTime::Seconds();
    
    FTestResult Result;
    Result.TestName = TestName;
    Result.TotalTime = (EndTime - StartTime) * 1000.0; // 毫秒
    Result.AverageTime = Result.TotalTime / NumTests;
    
    TestResults.Add(Result);
}

void APerformanceTestActor::PrintResults()
{
    UE_LOG(LogTemp, Warning, TEXT("=== Performance Test Results ==="));
    UE_LOG(LogTemp, Warning, TEXT("Number of tests per category: %d"), NumTests);
    UE_LOG(LogTemp, Warning, TEXT("Trace distance: %f"), TraceDistance);
    UE_LOG(LogTemp, Warning, TEXT(""));
    
    for (const FTestResult& Result : TestResults)
    {
        UE_LOG(LogTemp, Warning, TEXT("%s:"), *Result.TestName);
        UE_LOG(LogTemp, Warning, TEXT("  Total time: %f ms"), Result.TotalTime);
        UE_LOG(LogTemp, Warning, TEXT("  Average time: %f ms"), Result.AverageTime);
        UE_LOG(LogTemp, Warning, TEXT("  Traces per second: %f"), 1000.0 / Result.AverageTime);
        UE_LOG(LogTemp, Warning, TEXT(""));
    }
}
```

### 6.4 实际优化案例

#### 案例 1：优化交互系统

**问题：** 交互系统每帧检测，导致性能问题。

**优化前：**
```cpp
void AMyCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    CheckForInteractables(); // 每帧检测，60 FPS = 60 次/秒
}
```

**优化后：**
```cpp
// 使用定时器，降低到 10 FPS
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();
    GetWorldTimerManager().SetTimer(
        InteractableCheckTimer,
        this,
        &AMyCharacter::CheckForInteractables,
        0.1f, // 每 0.1 秒检测一次
        true
    );
}

// 性能提升：从 60 次/秒降低到 10 次/秒，CPU 占用减少 83%
```

#### 案例 2：优化武器系统

**问题：** 武器射击使用复杂碰撞，性能开销大。

**优化前：**
```cpp
FCollisionQueryParams Params;
Params.bTraceComplex = true; // 使用复杂碰撞
```

**优化后：**
```cpp
FCollisionQueryParams Params;
Params.bTraceComplex = false; // 使用简单碰撞
// 性能提升：快 5-15 倍
```

#### 案例 3：优化 AI 视线检测

**问题：** AI 每帧检测所有玩家的视线，性能开销大。

**优化方案：**
1. 降低检测频率（从 60 FPS 降到 5 FPS）
2. 使用距离剔除（只检测附近的玩家）
3. 使用专用碰撞通道（只检测玩家）

```cpp
void AMyAIController::CheckPlayerVisibility()
{
    // 只在距离小于 2000 单位时检测
    float DistanceToPlayer = FVector::Dist(
        GetPawn()->GetActorLocation(),
        PlayerLocation
    );
    
    if (DistanceToPlayer > 2000.0f)
    {
        return; // 距离太远，跳过检测
    }
    
    // 使用专用通道，只检测玩家
    FHitResult HitResult;
    GetWorld()->LineTraceSingleByChannel(
        HitResult,
        GetPawn()->GetActorLocation(),
        PlayerLocation,
        ECC_Pawn, // 专用通道
        FCollisionQueryParams()
    );
}
```

### 6.5 性能优化检查清单

在优化射线检测性能时，使用以下检查清单：

- [ ] **减少检测频率**
  - [ ] 是否每帧都检测？是否可以降低频率？
  - [ ] 是否可以使用事件驱动？
  - [ ] 是否可以使用距离阈值？

- [ ] **选择合适的检测类型**
  - [ ] 是否可以使用 Line Trace 代替 Sphere/Box Trace？
  - [ ] 检测类型是否与需求匹配？

- [ ] **限制检测距离**
  - [ ] 检测距离是否合理？
  - [ ] 是否可以动态调整距离？

- [ ] **使用碰撞通道过滤**
  - [ ] 是否使用了专用碰撞通道？
  - [ ] 是否检测了不必要的物体？

- [ ] **避免复杂碰撞**
  - [ ] 是否真的需要复杂碰撞？
  - [ ] 简单碰撞是否足够？

- [ ] **缓存和重用**
  - [ ] 查询参数是否被重用？
  - [ ] 是否可以缓存检测结果？

- [ ] **性能测试**
  - [ ] 是否进行了性能测试？
  - [ ] 是否使用了性能分析工具？
  - [ ] 是否达到了性能目标？

### 6.6 性能目标参考

不同场景的性能目标：

| 场景 | 检测频率 | 单次检测耗时 | 总 CPU 占用 |
|------|---------|------------|------------|
| 武器射击 | 按需 | < 0.1 ms | < 1% |
| 交互检测 | 10 FPS | < 0.5 ms | < 0.5% |
| 地面检测 | 30 FPS | < 0.3 ms | < 1% |
| AI 视线 | 5 FPS | < 1 ms | < 0.5% |
| 子弹下坠 | 按需 | < 5 ms | < 2% |

**注意：** 这些是参考值，实际性能取决于场景复杂度、物体数量等因素。

## 7. 常见问题与最佳实践

### 7.1 常见问题

**Q: 射线检测没有命中预期的物体？**

A: 检查以下几点：
1. 物体的碰撞设置是否正确（Collision Enabled）
2. 碰撞响应是否正确（Block 而不是 Ignore）
3. 使用的碰撞通道是否正确
4. 是否忽略了目标 Actor

**Q: 射线检测性能很差？**

A: 优化建议：
1. 减少检测频率
2. 使用简单碰撞而不是复杂碰撞
3. 限制检测距离
4. 使用合适的碰撞通道过滤

**Q: 如何检测特定类型的物体？**

A: 方法：
1. 使用自定义碰撞通道
2. 在检测后检查 Actor 的类型或标签
3. 使用接口系统

**Q: 如何实现穿透检测（检测所有路径上的物体）？**

A: 使用 `LineTraceMultiByChannel` 或相应的 Multi 函数。

### 7.2 最佳实践

1. **使用合适的检测类型**：
   - 简单检测用 Line Trace
   - 需要宽松检测用 Sphere/Capsule Trace

2. **合理设置碰撞通道**：
   - 为不同类型的检测使用不同的通道
   - 避免检测不必要的物体

3. **缓存检测结果**：
   - 不要每帧都检测
   - 使用合理的更新频率

4. **使用调试可视化**：
   - 开发时使用 `DrawDebugLine` 等函数
   - 发布时记得移除或禁用

5. **错误处理**：
   - 检查 `HitResult` 是否有效
   - 检查 `GetActor()` 是否为 nullptr

## 8. 总结

本文从零开始全面介绍了 UE5 的射线检测系统，包括：

1. **基础概念**：射线检测的原理、类型、碰撞通道和碰撞信息
2. **基础使用**：Line Trace、Sphere Trace、Box Trace、Capsule Trace 的使用方法
3. **实际应用**：武器系统、交互系统、地面检测、AI 视线检测等场景
4. **高级用法**：多目标检测、自定义碰撞通道、复杂碰撞检测
5. **性能优化**：优化建议和性能测试方法
6. **最佳实践**：常见问题的解决方案和开发建议

射线检测是游戏开发中非常重要的技术，掌握它能够实现很多核心功能。通过本文的学习，你应该能够：

- 理解射线检测的工作原理
- 使用不同类型的射线检测
- 在实际项目中应用射线检测
- 优化射线检测的性能
- 解决常见的射线检测问题

希望这篇文章能帮助你快速掌握 UE5 的射线检测系统！
