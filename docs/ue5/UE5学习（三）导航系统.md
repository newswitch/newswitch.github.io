---
title: UE5学习（三）导航系统
date: 2026-02-24 12:00:00
categories: UE5
tags: [UE5, Unreal Engine, 导航系统, Navigation System, NavMesh, AI寻路, 游戏开发]
---

# UE5学习（三）导航系统

> 本文是 UE5 学习系列的第三篇，面向刚开始接触 UE5 的开发者。我们将从零开始，深入理解 UE5 导航系统的原理，并通过完整的代码示例学会如何使用。

## 1. 导航系统概述

### 1.1 什么是导航系统

**导航系统（Navigation System）** 是 UE5 中用于 AI 寻路和角色移动的核心系统。它允许 AI 角色自动找到从起点到终点的路径，避开障碍物，在复杂的地形中导航。

**通俗理解：**

想象你在一个迷宫中，需要找到从入口到出口的路径。导航系统就像是给 AI 角色一张"地图"，告诉它哪些地方可以走，哪些地方不能走，以及如何找到最短或最优的路径。

### 1.2 为什么需要导航系统

在游戏开发中，导航系统有广泛的应用：

1. **AI 寻路**：
   - NPC 自动移动到目标位置
   - 敌人追击玩家
   - 友军跟随玩家

2. **自动移动**：
   - 点击地面让角色自动移动（RTS 游戏）
   - 自动寻路到任务目标
   - 自动避开障碍物

3. **路径规划**：
   - 计算最优路径
   - 避开动态障碍物
   - 处理复杂地形

4. **群体行为**：
   - 多个 AI 协调移动
   - 避免 AI 之间相互碰撞
   - 群体寻路优化

### 1.3 导航系统的工作原理

UE5 的导航系统基于 **NavMesh（导航网格）** 技术，工作流程如下：

```
1. 生成 NavMesh（导航网格）
   - 分析场景中的静态几何体
   - 生成可行走区域的网格
   ↓
2. AI 请求路径
   - AI 角色请求从 A 点到 B 点的路径
   ↓
3. 路径查找（Pathfinding）
   - 使用 A* 算法在 NavMesh 上查找路径
   - 考虑障碍物、成本等因素
   ↓
4. 返回路径点
   - 返回一系列路径点（Waypoints）
   ↓
5. AI 移动
   - AI 沿着路径点移动
   - 实时调整以避开动态障碍物
```

### 1.4 核心概念

**NavMesh（导航网格）**：
- 一个由多边形组成的网格，表示场景中可行走的区域
- 自动生成，基于场景中的静态几何体
- 可以手动调整和编辑

**NavMesh Bounds Volume**：
- 定义 NavMesh 生成的范围
- 只有在这个体积内的区域才会生成 NavMesh

**Nav Modifier Volume**：
- 修改 NavMesh 的属性（如成本、是否可行走）

**Pathfinding（路径查找）**：
- 在 NavMesh 上查找从起点到终点的路径
- 使用 A* 算法

**Path Following（路径跟随）**：
- AI 沿着计算出的路径移动
- 处理转向、速度调整等

## 2. 基础设置

### 2.1 生成 NavMesh

**步骤 1：添加 NavMesh Bounds Volume**

1. 在编辑器中，点击 `Window > Place Actors`
2. 搜索 `Nav Mesh Bounds Volume`
3. 拖拽到场景中
4. 调整大小，覆盖需要生成 NavMesh 的区域

**步骤 2：设置导航代理（Navigation Agent）**

导航代理定义了哪些类型的角色可以使用这个 NavMesh。

1. 打开项目设置：`Edit > Project Settings`
2. 导航到 `Engine > Navigation System`
3. 配置默认的导航代理设置：
   - **Agent Radius**：代理半径（通常与角色胶囊体半径相同）
   - **Agent Height**：代理高度（通常与角色胶囊体高度相同）
   - **Agent Max Step Height**：最大可跨越高度
   - **Agent Max Slope**：最大可行走坡度

**步骤 3：构建 NavMesh**

1. 在编辑器中，点击 `Build` 按钮（或按 `Ctrl+Shift+P`）
2. 选择 `Build > Build Paths`
3. 等待构建完成

构建完成后，你可以在编辑器中看到绿色的 NavMesh 网格（按 `P` 键切换显示）。

### 2.2 验证 NavMesh

**查看 NavMesh：**

1. 在编辑器中按 `P` 键，显示 NavMesh
2. 绿色区域表示可行走区域
3. 没有绿色的区域表示不可行走

**测试路径查找：**

1. 在场景中选择一个 AI 角色
2. 在 `Details` 面板中找到 `Navigation` 相关设置
3. 设置目标位置
4. 观察 AI 是否能够找到路径

## 3. 基础使用

### 3.1 简单的 AI 寻路

创建一个简单的 AI 角色，让它自动移动到目标位置。

```cpp
// SimpleAIController.h
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "Navigation/PathFollowingComponent.h"
#include "SimpleAIController.generated.h"

UCLASS()
class MYGAME_API ASimpleAIController : public AAIController
{
    GENERATED_BODY()

public:
    ASimpleAIController();

protected:
    virtual void BeginPlay() override;

public:
    // 移动到目标位置
    UFUNCTION(BlueprintCallable, Category = "AI")
    void MoveToLocation(FVector TargetLocation);

    // 移动到目标 Actor
    UFUNCTION(BlueprintCallable, Category = "AI")
    void MoveToActor(AActor* TargetActor);

    // 停止移动
    UFUNCTION(BlueprintCallable, Category = "AI")
    void StopMovement();

private:
    // 路径跟随组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components", meta = (AllowPrivateAccess = "true"))
    class UPathFollowingComponent* PathFollowingComponent;
};

// SimpleAIController.cpp
#include "SimpleAIController.h"
#include "Navigation/PathFollowingComponent.h"
#include "NavigationSystem.h"
#include "Engine/TargetPoint.h"

ASimpleAIController::ASimpleAIController()
{
    // 创建路径跟随组件
    PathFollowingComponent = CreateDefaultSubobject<UPathFollowingComponent>(TEXT("PathFollowingComponent"));
}

void ASimpleAIController::BeginPlay()
{
    Super::BeginPlay();
}

void ASimpleAIController::MoveToLocation(FVector TargetLocation)
{
    if (!GetPawn())
    {
        return;
    }

    // 获取导航系统
    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        UE_LOG(LogTemp, Warning, TEXT("Navigation System not found!"));
        return;
    }

    // 查找路径并移动
    FNavPathSharedPtr NavPath;
    EPathFollowingRequestResult::Type Result = MoveToLocation(
        TargetLocation,
        50.0f, // 接受半径（到达目标点 50 单位内就算到达）
        false, // 不使用路径查找
        true,  // 允许部分路径
        true,  // 使用项目设置
        nullptr, // 自定义过滤器
        true    // 使用导航数据
    );

    if (Result == EPathFollowingRequestResult::RequestSuccessful)
    {
        UE_LOG(LogTemp, Warning, TEXT("Move to location started successfully"));
    }
    else
    {
        UE_LOG(LogTemp, Warning, TEXT("Failed to move to location"));
    }
}

void ASimpleAIController::MoveToActor(AActor* TargetActor)
{
    if (!TargetActor || !GetPawn())
    {
        return;
    }

    // 移动到 Actor 的位置
    EPathFollowingRequestResult::Type Result = MoveToActor(
        TargetActor,
        50.0f, // 接受半径
        false, // 不使用路径查找
        true,  // 允许部分路径
        true,  // 使用项目设置
        nullptr, // 自定义过滤器
        true    // 使用导航数据
    );

    if (Result == EPathFollowingRequestResult::RequestSuccessful)
    {
        UE_LOG(LogTemp, Warning, TEXT("Move to actor started successfully"));
    }
}

void ASimpleAIController::StopMovement()
{
    StopMovement();
    UE_LOG(LogTemp, Warning, TEXT("Movement stopped"));
}
```

### 3.2 在蓝图中使用

**方法 1：使用 AI Move To 节点**

1. 在 AI Controller 蓝图中
2. 添加 `AI Move To` 节点
3. 设置目标位置或目标 Actor
4. 连接执行流程

**方法 2：使用 Behavior Tree**

1. 创建 Behavior Tree
2. 添加 `Move To` 任务节点
3. 设置 Blackboard Key（目标位置）
4. 在 AI Controller 中运行 Behavior Tree

### 3.3 检查路径是否可达

在移动之前，检查目标位置是否可达。

```cpp
// MyAIController.h
public:
    // 检查位置是否可达
    UFUNCTION(BlueprintCallable, Category = "AI")
    bool IsLocationReachable(FVector TargetLocation);

// MyAIController.cpp
bool AMyAIController::IsLocationReachable(FVector TargetLocation)
{
    if (!GetPawn())
    {
        return false;
    }

    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return false;
    }

    // 获取导航数据
    ANavigationData* NavData = NavSystem->GetNavDataForProps(
        GetNavAgentPropertiesRef(),
        GetNavAgentLocation()
    );

    if (!NavData)
    {
        return false;
    }

    // 检查路径是否存在
    FNavLocation NavLocation;
    bool bFound = NavSystem->ProjectPointToNavigation(
        TargetLocation,
        NavLocation,
        FVector(1000.0f, 1000.0f, 1000.0f), // 搜索范围
        NavData
    );

    return bFound;
}
```

## 4. 高级功能

### 4.1 动态障碍物

**问题：** 场景中的动态物体（如可移动的箱子、门）会阻挡 AI 路径，但 NavMesh 是基于静态几何体生成的。

**解决方案：** 使用 Nav Modifier Volume 或动态障碍物组件。

**方法 1：使用 Nav Modifier Volume**

1. 在编辑器中添加 `Nav Modifier Volume`
2. 设置体积大小，覆盖动态障碍物区域
3. 设置 `Area Class` 为 `NavArea_Obstacle`（不可行走）
4. 在代码中动态启用/禁用这个 Volume

**方法 2：使用 Dynamic Obstacle**

```cpp
// DynamicObstacle.h
UCLASS()
class MYGAME_API ADynamicObstacle : public AActor
{
    GENERATED_BODY()

public:
    ADynamicObstacle();

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

    // 碰撞组件（用于阻挡 AI）
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    class UBoxComponent* ObstacleCollision;

    // 导航障碍物组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    class UNavModifierComponent* NavModifierComponent;
};

// DynamicObstacle.cpp
#include "DynamicObstacle.h"
#include "Components/BoxComponent.h"
#include "Navigation/NavModifierComponent.h"
#include "AI/Navigation/NavAreas/NavArea_Obstacle.h"

ADynamicObstacle::ADynamicObstacle()
{
    PrimaryActorTick.bCanEverTick = true;

    // 创建碰撞组件
    ObstacleCollision = CreateDefaultSubobject<UBoxComponent>(TEXT("ObstacleCollision"));
    RootComponent = ObstacleCollision;
    ObstacleCollision->SetBoxExtent(FVector(50.0f, 50.0f, 50.0f));

    // 创建导航修改器组件
    NavModifierComponent = CreateDefaultSubobject<UNavModifierComponent>(TEXT("NavModifierComponent"));
    NavModifierComponent->SetAreaClass(UNavArea_Obstacle::StaticClass());
    NavModifierComponent->SetFailsafeExtent(FVector(100.0f, 100.0f, 100.0f));
}

void ADynamicObstacle::BeginPlay()
{
    Super::BeginPlay();
    
    // 更新导航网格
    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (NavSystem)
    {
        NavSystem->UpdateComponentInNavOctree(*NavModifierComponent);
    }
}

void ADynamicObstacle::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    
    // 如果障碍物移动了，更新导航网格
    // 注意：频繁更新会影响性能，应该只在必要时更新
    static FVector LastLocation = FVector::ZeroVector;
    FVector CurrentLocation = GetActorLocation();
    
    if (FVector::Dist(CurrentLocation, LastLocation) > 10.0f)
    {
        UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
        if (NavSystem)
        {
            NavSystem->UpdateComponentInNavOctree(*NavModifierComponent);
        }
        LastLocation = CurrentLocation;
    }
}
```

### 4.2 自定义导航区域

创建自定义的导航区域，用于标记不同类型的区域（如水域、危险区域等）。

**步骤 1：创建导航区域类**

```cpp
// NavArea_Water.h
#pragma once

#include "CoreMinimal.h"
#include "AI/Navigation/NavAreas/NavArea.h"
#include "NavArea_Water.generated.h"

UCLASS()
class MYGAME_API UNavArea_Water : public UNavArea
{
    GENERATED_BODY()

public:
    UNavArea_Water(const FObjectInitializer& ObjectInitializer)
    {
        // 设置区域成本（水域更难行走，成本更高）
        FNavAreaHelper::Set(AreaFlags, ENavAreaFlag::Cost);
        DefaultCost = 5.0f; // 默认成本是 1.0，水域是 5.0（更难走）
        
        // 设置是否可以行走（如果设置为 false，AI 会完全避开）
        // DrawColor = FColor::Blue; // 在编辑器中显示为蓝色
    }
};
```

**步骤 2：在编辑器中应用**

1. 添加 `Nav Modifier Volume`
2. 设置 `Area Class` 为你创建的自定义区域类
3. 调整体积大小，覆盖目标区域

**步骤 3：在代码中使用**

```cpp
// 在 AI Controller 中，可以检查当前所在的区域类型
void AMyAIController::CheckCurrentArea()
{
    if (!GetPawn())
    {
        return;
    }

    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return;
    }

    FNavLocation NavLocation;
    bool bFound = NavSystem->ProjectPointToNavigation(
        GetPawn()->GetActorLocation(),
        NavLocation
    );

    if (bFound)
    {
        // 获取当前区域的类型
        const UNavArea* CurrentArea = NavLocation.NodeRef.IsValid() 
            ? NavSystem->GetNavAreaClass(NavLocation.NodeRef) 
            : nullptr;

        if (CurrentArea && CurrentArea->IsA<UNavArea_Water>())
        {
            UE_LOG(LogTemp, Warning, TEXT("AI is in water area!"));
            // 可以在这里添加特殊逻辑，如减速、播放水花特效等
        }
    }
}
```

### 4.3 路径查询和调试

获取路径信息，用于调试或显示路径。

```cpp
// MyAIController.h
public:
    // 获取路径点
    UFUNCTION(BlueprintCallable, Category = "AI")
    TArray<FVector> GetPathPoints(FVector TargetLocation);

    // 绘制路径（调试用）
    UFUNCTION(BlueprintCallable, Category = "AI")
    void DrawPath(FVector TargetLocation);

// MyAIController.cpp
#include "DrawDebugHelpers.h"

TArray<FVector> AMyAIController::GetPathPoints(FVector TargetLocation)
{
    TArray<FVector> PathPoints;

    if (!GetPawn())
    {
        return PathPoints;
    }

    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return PathPoints;
    }

    // 创建路径查询
    FPathFindingQuery Query;
    Query.StartLocation = GetPawn()->GetActorLocation();
    Query.EndLocation = TargetLocation;
    Query.NavData = NavSystem->GetNavDataForProps(GetNavAgentPropertiesRef(), Query.StartLocation);
    Query.Owner = this;

    // 查找路径
    FPathFindingResult Result = NavSystem->FindPathSync(Query);

    if (Result.IsSuccessful())
    {
        // 获取路径点
        const FNavPathSharedPtr& Path = Result.Path;
        if (Path.IsValid())
        {
            const TArray<FNavPathPoint>& PathPointsRef = Path->GetPathPoints();
            for (const FNavPathPoint& Point : PathPointsRef)
            {
                PathPoints.Add(Point.Location);
            }
        }
    }

    return PathPoints;
}

void AMyAIController::DrawPath(FVector TargetLocation)
{
    TArray<FVector> PathPoints = GetPathPoints(TargetLocation);

    if (PathPoints.Num() < 2)
    {
        UE_LOG(LogTemp, Warning, TEXT("No valid path found"));
        return;
    }

    // 绘制路径
    for (int32 i = 0; i < PathPoints.Num() - 1; ++i)
    {
        DrawDebugLine(
            GetWorld(),
            PathPoints[i],
            PathPoints[i + 1],
            FColor::Green,
            false,
            5.0f,
            0,
            3.0f
        );

        // 绘制路径点
        DrawDebugSphere(
            GetWorld(),
            PathPoints[i],
            20.0f,
            12,
            FColor::Yellow,
            false,
            5.0f
        );
    }

    // 绘制最后一个点
    DrawDebugSphere(
        GetWorld(),
        PathPoints.Last(),
        20.0f,
        12,
        FColor::Red,
        false,
        5.0f
    );
}
```

### 4.4 路径成本（Path Cost）

使用路径成本来影响 AI 的路径选择。

```cpp
// 在自定义导航区域中设置成本
// NavArea_Danger.h
UCLASS()
class MYGAME_API UNavArea_Danger : public UNavArea
{
    GENERATED_BODY()

public:
    UNavArea_Danger(const FObjectInitializer& ObjectInitializer)
    {
        FNavAreaHelper::Set(AreaFlags, ENavAreaFlag::Cost);
        DefaultCost = 10.0f; // 危险区域成本很高，AI 会尽量避免
        DrawColor = FColor::Red; // 在编辑器中显示为红色
    }
};
```

**在路径查找时考虑成本：**

```cpp
void AMyAIController::FindPathWithCost(FVector TargetLocation)
{
    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return;
    }

    FPathFindingQuery Query;
    Query.StartLocation = GetPawn()->GetActorLocation();
    Query.EndLocation = TargetLocation;
    Query.NavData = NavSystem->GetNavDataForProps(GetNavAgentPropertiesRef(), Query.StartLocation);
    Query.Owner = this;

    // 设置路径查找参数
    Query.SetAllowPartialPaths(false); // 不允许部分路径
    Query.SetRequireNavigableEndLocation(true); // 要求终点可导航

    // 查找路径（会自动考虑区域成本）
    FPathFindingResult Result = NavSystem->FindPathSync(Query);

    if (Result.IsSuccessful())
    {
        UE_LOG(LogTemp, Warning, TEXT("Path found! Cost: %f"), Result.Path->GetCost());
    }
}
```

## 5. 实际应用场景

### 5.1 场景 1：敌人 AI 追击玩家

实现一个敌人 AI，当发现玩家时自动追击。

```cpp
// EnemyAIController.h
UCLASS()
class MYGAME_API AEnemyAIController : public AAIController
{
    GENERATED_BODY()

public:
    AEnemyAIController();

protected:
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;

private:
    // 检测玩家
    void CheckForPlayer();

    // 追击玩家
    void ChasePlayer();

    // 玩家引用
    AActor* PlayerActor = nullptr;

    // 检测距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    float DetectionDistance = 1000.0f;

    // 追击距离
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    float ChaseDistance = 2000.0f;

    // 是否正在追击
    bool bIsChasing = false;
};

// EnemyAIController.cpp
#include "EnemyAIController.h"
#include "Kismet/GameplayStatics.h"
#include "NavigationSystem.h"

AEnemyAIController::AEnemyAIController()
{
    PrimaryActorTick.bCanEverTick = true;
}

void AEnemyAIController::BeginPlay()
{
    Super::BeginPlay();
    
    // 获取玩家引用
    PlayerActor = UGameplayStatics::GetPlayerCharacter(GetWorld(), 0);
}

void AEnemyAIController::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (!GetPawn() || !PlayerActor)
    {
        return;
    }

    // 检测玩家
    CheckForPlayer();

    // 如果正在追击，更新目标位置
    if (bIsChasing)
    {
        ChasePlayer();
    }
}

void AEnemyAIController::CheckForPlayer()
{
    if (!GetPawn() || !PlayerActor)
    {
        return;
    }

    float DistanceToPlayer = FVector::Dist(
        GetPawn()->GetActorLocation(),
        PlayerActor->GetActorLocation()
    );

    // 如果玩家在检测范围内
    if (DistanceToPlayer <= DetectionDistance)
    {
        if (!bIsChasing)
        {
            bIsChasing = true;
            UE_LOG(LogTemp, Warning, TEXT("Enemy started chasing player!"));
        }
    }
    else if (DistanceToPlayer > ChaseDistance)
    {
        // 玩家超出追击距离，停止追击
        if (bIsChasing)
        {
            bIsChasing = false;
            StopMovement();
            UE_LOG(LogTemp, Warning, TEXT("Enemy stopped chasing player"));
        }
    }
}

void AEnemyAIController::ChasePlayer()
{
    if (!GetPawn() || !PlayerActor)
    {
        return;
    }

    // 移动到玩家位置
    EPathFollowingRequestResult::Type Result = MoveToActor(
        PlayerActor,
        100.0f, // 接受半径
        false,
        true,
        true,
        nullptr,
        true
    );

    if (Result != EPathFollowingRequestResult::RequestSuccessful)
    {
        UE_LOG(LogTemp, Warning, TEXT("Failed to chase player"));
    }
}
```

### 5.2 场景 2：RTS 风格的点击移动

实现点击地面让角色自动移动的功能。

```cpp
// RTSCharacter.h
UCLASS()
class MYGAME_API ARTSCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    ARTSCharacter();

protected:
    virtual void BeginPlay() override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    // 处理鼠标点击
    void OnMouseClick();

    // 移动到目标位置
    void MoveToTarget(FVector TargetLocation);

private:
    // AI Controller 引用
    class AAIController* AIController;
};

// RTSCharacter.cpp
#include "RTSCharacter.h"
#include "AIController.h"
#include "NavigationSystem.h"
#include "Engine/World.h"
#include "Components/InputComponent.h"

ARTSCharacter::ARTSCharacter()
{
    PrimaryActorTick.bCanEverTick = false;
}

void ARTSCharacter::BeginPlay()
{
    Super::BeginPlay();
    
    // 获取 AI Controller
    AIController = Cast<AAIController>(GetController());
}

void ARTSCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    // 绑定鼠标左键
    PlayerInputComponent->BindAction("LeftMouseClick", IE_Pressed, this, &ARTSCharacter::OnMouseClick);
}

void ARTSCharacter::OnMouseClick()
{
    if (!AIController)
    {
        return;
    }

    // 获取鼠标位置
    APlayerController* PC = Cast<APlayerController>(GetController());
    if (!PC)
    {
        return;
    }

    FVector WorldLocation, WorldDirection;
    if (PC->DeprojectMousePositionToWorld(WorldLocation, WorldDirection))
    {
        // 执行射线检测，找到点击的地面位置
        FHitResult HitResult;
        FVector StartLocation = WorldLocation;
        FVector EndLocation = WorldLocation + (WorldDirection * 10000.0f);

        if (GetWorld()->LineTraceSingleByChannel(
            HitResult,
            StartLocation,
            EndLocation,
            ECC_Visibility
        ))
        {
            // 移动到点击位置
            MoveToTarget(HitResult.Location);
        }
    }
}

void ARTSCharacter::MoveToTarget(FVector TargetLocation)
{
    if (!AIController)
    {
        return;
    }

    // 检查位置是否可达
    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return;
    }

    FNavLocation NavLocation;
    if (NavSystem->ProjectPointToNavigation(TargetLocation, NavLocation, FVector(500.0f, 500.0f, 500.0f)))
    {
        // 移动到导航位置
        AIController->MoveToLocation(NavLocation.Location, 50.0f);
        UE_LOG(LogTemp, Warning, TEXT("Moving to: %s"), *NavLocation.Location.ToString());
    }
    else
    {
        UE_LOG(LogTemp, Warning, TEXT("Target location is not reachable"));
    }
}
```

### 5.3 场景 3：群体移动和避让

实现多个 AI 协调移动，避免相互碰撞。

```cpp
// GroupAIController.h
UCLASS()
class MYGAME_API AGroupAIController : public AAIController
{
    GENERATED_BODY()

public:
    AGroupAIController();

protected:
    virtual void BeginPlay() override;

public:
    // 移动到目标位置（考虑其他 AI）
    UFUNCTION(BlueprintCallable, Category = "AI")
    void MoveToLocationWithAvoidance(FVector TargetLocation);

private:
    // 检查是否有其他 AI 在路径上
    bool HasObstacleInPath(FVector StartLocation, FVector EndLocation);

    // 避让半径
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    float AvoidanceRadius = 200.0f;
};

// GroupAIController.cpp
#include "GroupAIController.h"
#include "NavigationSystem.h"
#include "GameFramework/Character.h"
#include "Kismet/KismetSystemLibrary.h"

AGroupAIController::AGroupAIController()
{
    PrimaryActorTick.bCanEverTick = false;
}

void AGroupAIController::BeginPlay()
{
    Super::BeginPlay();
}

void AGroupAIController::MoveToLocationWithAvoidance(FVector TargetLocation)
{
    if (!GetPawn())
    {
        return;
    }

    FVector StartLocation = GetPawn()->GetActorLocation();
    
    // 检查路径上是否有障碍物
    if (HasObstacleInPath(StartLocation, TargetLocation))
    {
        // 如果有障碍物，尝试绕行
        // 这里可以使用更复杂的避让算法
        UE_LOG(LogTemp, Warning, TEXT("Obstacle detected, calculating alternative path"));
    }

    // 移动到目标位置
    MoveToLocation(TargetLocation, 50.0f);
}

bool AGroupAIController::HasObstacleInPath(FVector StartLocation, FVector EndLocation)
{
    // 使用 Sphere Trace 检测路径上的障碍物
    TArray<FHitResult> HitResults;
    
    UKismetSystemLibrary::SphereTraceMulti(
        GetWorld(),
        StartLocation,
        EndLocation,
        AvoidanceRadius,
        UEngineTypes::ConvertToTraceType(ECC_Pawn), // 检测其他角色
        false,
        TArray<AActor*>(),
        EDrawDebugTrace::None,
        HitResults,
        true
    );

    // 检查是否命中其他 AI（排除自己）
    for (const FHitResult& Hit : HitResults)
    {
        AActor* HitActor = Hit.GetActor();
        if (HitActor && HitActor != GetPawn())
        {
            // 检查是否是 AI 角色
            if (HitActor->IsA<ACharacter>())
            {
                return true;
            }
        }
    }

    return false;
}
```

## 6. 性能优化

### 6.1 NavMesh 构建优化

**问题：** 大型场景的 NavMesh 构建可能很慢。

**优化方法：**

1. **使用多个 NavMesh Bounds Volume**：
   - 将场景分成多个区域
   - 每个区域使用独立的 Volume
   - 只构建需要的区域

2. **调整 NavMesh 精度**：
   - 在项目设置中调整 `Cell Size` 和 `Cell Height`
   - 较大的值 = 更快的构建，但精度较低
   - 较小的值 = 更慢的构建，但精度较高

3. **使用 NavMesh 代理过滤**：
   - 只为需要的代理类型生成 NavMesh
   - 减少不必要的 NavMesh 数据

### 6.2 路径查找优化

**问题：** 频繁的路径查找会影响性能。

**优化方法：**

1. **缓存路径**：
   - 如果目标位置不变，缓存路径结果
   - 只在目标改变时重新查找

2. **异步路径查找**：
   - 使用异步路径查找，避免阻塞游戏线程
   - 适用于非关键路径

3. **限制路径查找频率**：
   - 不要每帧都查找路径
   - 使用定时器或事件驱动

```cpp
// 异步路径查找示例
void AMyAIController::FindPathAsync(FVector TargetLocation)
{
    UNavigationSystemV1* NavSystem = UNavigationSystemV1::GetCurrent(GetWorld());
    if (!NavSystem)
    {
        return;
    }

    FPathFindingQuery Query;
    Query.StartLocation = GetPawn()->GetActorLocation();
    Query.EndLocation = TargetLocation;
    Query.NavData = NavSystem->GetNavDataForProps(GetNavAgentPropertiesRef(), Query.StartLocation);
    Query.Owner = this;

    // 异步查找路径
    NavSystem->FindPathAsync(
        Query,
        FOnPathFindingResult::CreateUObject(this, &AMyAIController::OnPathFound)
    );
}

void AMyAIController::OnPathFound(uint32 PathId, ENavigationQueryResult::Type Result, FNavPathSharedPtr Path)
{
    if (Result == ENavigationQueryResult::Success && Path.IsValid())
    {
        // 使用找到的路径
        MoveToLocation(Path->GetEndLocation());
    }
}
```

### 6.3 动态障碍物优化

**问题：** 频繁更新动态障碍物会影响性能。

**优化方法：**

1. **只在必要时更新**：
   - 只在障碍物移动超过阈值时更新
   - 使用距离或时间阈值

2. **批量更新**：
   - 将多个障碍物的更新合并
   - 减少 NavMesh 更新次数

3. **使用 Nav Modifier Volume**：
   - 对于大型动态区域，使用 Volume 而不是组件
   - 性能更好

## 7. 常见问题与最佳实践

### 7.1 常见问题

**Q: NavMesh 没有生成？**

A: 检查以下几点：
1. 是否添加了 NavMesh Bounds Volume？
2. Volume 是否覆盖了需要生成 NavMesh 的区域？
3. 场景中是否有静态几何体？
4. 是否执行了构建操作？

**Q: AI 找不到路径？**

A: 检查以下几点：
1. 起点和终点是否在 NavMesh 上？
2. 导航代理设置是否正确（半径、高度等）？
3. 是否有障碍物阻挡路径？
4. NavMesh 是否已正确构建？

**Q: AI 移动不流畅？**

A: 优化建议：
1. 检查移动速度设置
2. 调整路径跟随参数（接受半径、转向速度等）
3. 使用更平滑的移动插值

**Q: 动态障碍物不生效？**

A: 检查以下几点：
1. 是否添加了 Nav Modifier Component？
2. 是否调用了 `UpdateComponentInNavOctree`？
3. NavMesh 是否支持动态更新？

### 7.2 最佳实践

1. **合理设置导航代理**：
   - 代理半径应该与角色胶囊体半径匹配
   - 代理高度应该与角色胶囊体高度匹配

2. **使用合适的 NavMesh 精度**：
   - 简单场景使用较低的精度（较大的 Cell Size）
   - 复杂场景使用较高的精度（较小的 Cell Size）

3. **优化路径查找频率**：
   - 不要每帧都查找路径
   - 使用缓存和异步查找

4. **合理使用动态障碍物**：
   - 只在必要时更新
   - 使用批量更新

5. **测试和调试**：
   - 使用路径绘制功能调试
   - 检查 NavMesh 覆盖范围
   - 验证路径可达性

## 8. 总结

本文从零开始全面介绍了 UE5 的导航系统，包括：

1. **基础概念**：NavMesh、导航代理、路径查找等核心概念
2. **基础设置**：如何生成和使用 NavMesh
3. **基础使用**：简单的 AI 寻路实现
4. **高级功能**：动态障碍物、自定义导航区域、路径查询等
5. **实际应用**：敌人追击、RTS 移动、群体避让等场景
6. **性能优化**：NavMesh 构建、路径查找、动态障碍物优化
7. **最佳实践**：常见问题的解决方案和开发建议

导航系统是 UE5 AI 开发的核心功能，掌握它能够实现各种复杂的 AI 行为。通过本文的学习，你应该能够：

- 理解导航系统的工作原理
- 生成和使用 NavMesh
- 实现基本的 AI 寻路
- 处理动态障碍物和自定义区域
- 优化导航系统性能
- 解决常见的导航问题

希望这篇文章能帮助你快速掌握 UE5 的导航系统！
