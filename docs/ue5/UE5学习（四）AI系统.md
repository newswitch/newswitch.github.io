---
title: UE5学习（四）AI系统
date: 2026-02-24 12:00:00
categories: UE5
tags: [UE5, Unreal Engine, AI系统, Behavior Tree, Blackboard, EQS, 感知系统, 游戏开发]
---

# UE5学习（四）AI系统

> 本文是 UE5 学习系列的第四篇，面向刚开始接触 UE5 的开发者。我们将从零开始，深入理解 UE5 AI 系统的原理，并通过完整的代码示例学会如何使用。

## 1. AI 系统概述

### 1.1 什么是 AI 系统

**AI 系统（Artificial Intelligence System）** 是 UE5 中用于创建智能 NPC、敌人、友军等角色的完整框架。它提供了行为树、黑板、感知系统、环境查询系统等工具，让开发者能够创建复杂的 AI 行为。

**通俗理解：**

想象你在设计一个智能机器人，需要告诉它：
- 什么时候做什么（行为树）
- 记住什么信息（黑板）
- 如何感知周围环境（感知系统）
- 如何选择最佳位置（环境查询系统）

UE5 的 AI 系统就是提供这些功能的完整工具集。

### 1.2 为什么需要 AI 系统

在游戏开发中，AI 系统有广泛的应用：

1. **敌人 AI**：
   - 自动巡逻
   - 发现玩家后追击
   - 寻找掩体
   - 攻击玩家

2. **NPC AI**：
   - 对话系统
   - 任务系统
   - 日常行为模拟

3. **友军 AI**：
   - 跟随玩家
   - 协助战斗
   - 自动治疗

4. **群体 AI**：
   - 多个 AI 协调行动
   - 群体行为模拟

### 1.3 AI 系统的核心组件

UE5 的 AI 系统由以下几个核心组件组成：

1. **AI Controller（AI 控制器）**：
   - AI 的"大脑"，控制 AI 的行为
   - 管理行为树、黑板、感知系统

2. **Behavior Tree（行为树）**：
   - 定义 AI 的行为逻辑
   - 使用节点树结构组织行为

3. **Blackboard（黑板）**：
   - AI 的"记忆"，存储共享数据
   - 行为树和感知系统都可以读写

4. **Perception System（感知系统）**：
   - AI 的"感官"，检测周围环境
   - 视觉、听觉、伤害感知等

5. **EQS（Environment Query System，环境查询系统）**：
   - 查询环境中的最佳位置
   - 用于寻找掩体、攻击位置等

6. **Navigation System（导航系统）**：
   - AI 的"导航能力"（见第三篇文章）
   - 与 AI 系统紧密集成

### 1.4 AI 系统的工作流程

```
1. AI Controller 初始化
   - 创建行为树、黑板、感知系统
   ↓
2. 感知系统检测环境
   - 检测玩家、敌人、声音等
   - 更新 Blackboard 数据
   ↓
3. Behavior Tree 执行
   - 根据 Blackboard 数据选择行为
   - 执行对应的任务（移动、攻击等）
   ↓
4. 任务执行
   - 移动、攻击、寻找掩体等
   - 使用导航系统、EQS 等
   ↓
5. 循环执行
   - 持续感知和执行
```

## 2. AI Controller（AI 控制器）

### 2.1 什么是 AI Controller

**AI Controller** 是 AI 角色的"大脑"，负责控制 AI 的所有行为。它继承自 `AController`，类似于 `PlayerController`，但用于 AI 控制。

**主要功能：**
- 管理 Behavior Tree 的执行
- 管理 Blackboard 数据
- 管理感知系统
- 控制 AI 的移动和行动

### 2.2 创建 AI Controller

```cpp
// MyAIController.h
#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "Perception/AIPerceptionComponent.h"
#include "Perception/AISightPerceptionComponent.h"
#include "BehaviorTree/BehaviorTreeComponent.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "MyAIController.generated.h"

UCLASS()
class MYGAME_API AMyAIController : public AAIController
{
    GENERATED_BODY()

public:
    AMyAIController();

protected:
    virtual void BeginPlay() override;
    virtual void OnPossess(APawn* InPawn) override;
    virtual void OnUnPossess() override;

    // Behavior Tree 组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "AI")
    class UBehaviorTreeComponent* BehaviorTreeComponent;

    // Blackboard 组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "AI")
    class UBlackboardComponent* BlackboardComponent;

    // 感知组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "AI")
    class UAIPerceptionComponent* PerceptionComponent;

    // 视觉感知组件
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "AI")
    class UAISightPerceptionComponent* SightPerceptionComponent;

public:
    // Behavior Tree 资源
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    class UBehaviorTree* BehaviorTree;

    // Blackboard 资源
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    class UBlackboardData* BlackboardData;
};

// MyAIController.cpp
#include "MyAIController.h"
#include "BehaviorTree/BehaviorTreeComponent.h"
#include "BehaviorTree/BlackboardComponent.h"
#include "Perception/AIPerceptionComponent.h"
#include "Perception/AISightPerceptionComponent.h"
#include "Perception/AIPerceptionStimuliSourceComponent.h"

AMyAIController::AMyAIController()
{
    PrimaryActorTick.bCanEverTick = true;

    // 创建 Behavior Tree 组件
    BehaviorTreeComponent = CreateDefaultSubobject<UBehaviorTreeComponent>(TEXT("BehaviorTreeComponent"));

    // 创建 Blackboard 组件
    BlackboardComponent = CreateDefaultSubobject<UBlackboardComponent>(TEXT("BlackboardComponent"));

    // 创建感知组件
    PerceptionComponent = CreateDefaultSubobject<UAIPerceptionComponent>(TEXT("PerceptionComponent"));
    SightPerceptionComponent = CreateDefaultSubobject<UAISightPerceptionComponent>(TEXT("SightPerceptionComponent"));
}

void AMyAIController::BeginPlay()
{
    Super::BeginPlay();

    // 初始化 Blackboard
    if (BlackboardData)
    {
        BlackboardComponent->InitializeBlackboard(*BlackboardData);
    }

    // 启动 Behavior Tree
    if (BehaviorTree)
    {
        RunBehaviorTree(BehaviorTree);
    }
}

void AMyAIController::OnPossess(APawn* InPawn)
{
    Super::OnPossess(InPawn);

    // 当控制 Pawn 时，初始化 AI 系统
    if (BlackboardData)
    {
        BlackboardComponent->InitializeBlackboard(*BlackboardData);
    }

    if (BehaviorTree)
    {
        RunBehaviorTree(BehaviorTree);
    }
}

void AMyAIController::OnUnPossess()
{
    Super::OnUnPossess();

    // 停止 Behavior Tree
    if (BehaviorTreeComponent)
    {
        BehaviorTreeComponent->StopTree();
    }
}
```

### 2.3 AI Controller 的常用功能

```cpp
// MyAIController.h
public:
    // 设置 Blackboard 值
    UFUNCTION(BlueprintCallable, Category = "AI")
    void SetBlackboardValue(FName KeyName, bool Value);

    UFUNCTION(BlueprintCallable, Category = "AI")
    void SetBlackboardValueVector(FName KeyName, FVector Value);

    UFUNCTION(BlueprintCallable, Category = "AI")
    void SetBlackboardValueObject(FName KeyName, UObject* Value);

    // 获取 Blackboard 值
    UFUNCTION(BlueprintCallable, Category = "AI")
    bool GetBlackboardValueBool(FName KeyName);

    UFUNCTION(BlueprintCallable, Category = "AI")
    FVector GetBlackboardValueVector(FName KeyName);

    UFUNCTION(BlueprintCallable, Category = "AI")
    AActor* GetBlackboardValueObject(FName KeyName);

// MyAIController.cpp
void AMyAIController::SetBlackboardValue(FName KeyName, bool Value)
{
    if (BlackboardComponent)
    {
        BlackboardComponent->SetValueAsBool(KeyName, Value);
    }
}

void AMyAIController::SetBlackboardValueVector(FName KeyName, FVector Value)
{
    if (BlackboardComponent)
    {
        BlackboardComponent->SetValueAsVector(KeyName, Value);
    }
}

void AMyAIController::SetBlackboardValueObject(FName KeyName, UObject* Value)
{
    if (BlackboardComponent)
    {
        BlackboardComponent->SetValueAsObject(KeyName, Value);
    }
}

bool AMyAIController::GetBlackboardValueBool(FName KeyName)
{
    if (BlackboardComponent)
    {
        return BlackboardComponent->GetValueAsBool(KeyName);
    }
    return false;
}

FVector AMyAIController::GetBlackboardValueVector(FName KeyName)
{
    if (BlackboardComponent)
    {
        return BlackboardComponent->GetValueAsVector(KeyName);
    }
    return FVector::ZeroVector;
}

AActor* AMyAIController::GetBlackboardValueObject(FName KeyName)
{
    if (BlackboardComponent)
    {
        return Cast<AActor>(BlackboardComponent->GetValueAsObject(KeyName));
    }
    return nullptr;
}
```

## 3. Blackboard（黑板）

### 3.1 什么是 Blackboard

**Blackboard（黑板）** 是 AI 系统的"记忆"，用于存储和共享数据。Behavior Tree、感知系统、任务节点等都可以读写 Blackboard 中的数据。

**通俗理解：**

想象 Blackboard 是一个公告板，不同的系统可以在上面写信息、读信息：
- 感知系统："我看到玩家在 (100, 200, 50)"
- 行为树："好的，我去追击玩家"
- 任务节点："玩家位置已更新"

### 3.2 创建 Blackboard

**步骤 1：创建 Blackboard 资源**

1. 在内容浏览器中右键点击
2. 选择 `Artificial Intelligence > Blackboard`
3. 命名并创建（例如：`BB_EnemyAI`）

**步骤 2：添加 Keys（键）**

在 Blackboard 编辑器中，点击 `New Key` 添加键：

- **Bool**：布尔值（例如：`HasTarget`、`IsPatrolling`）
- **Int**：整数（例如：`Health`、`AmmoCount`）
- **Float**：浮点数（例如：`DistanceToTarget`）
- **Vector**：向量（例如：`TargetLocation`、`PatrolPoint`）
- **Object**：对象引用（例如：`TargetActor`、`EnemyActor`）
- **Enum**：枚举（例如：`AIState`、`CombatState`）

**常用 Keys 示例：**

```
- TargetActor (Object) - 目标 Actor
- TargetLocation (Vector) - 目标位置
- HasTarget (Bool) - 是否有目标
- IsPatrolling (Bool) - 是否在巡逻
- PatrolPoint (Vector) - 巡逻点
- CanSeePlayer (Bool) - 是否能看到玩家
- DistanceToTarget (Float) - 到目标的距离
```

### 3.3 在代码中使用 Blackboard

```cpp
// 设置 Blackboard 值
BlackboardComponent->SetValueAsBool("HasTarget", true);
BlackboardComponent->SetValueAsVector("TargetLocation", FVector(100, 200, 50));
BlackboardComponent->SetValueAsObject("TargetActor", PlayerActor);

// 获取 Blackboard 值
bool bHasTarget = BlackboardComponent->GetValueAsBool("HasTarget");
FVector TargetLoc = BlackboardComponent->GetValueAsVector("TargetLocation");
AActor* Target = Cast<AActor>(BlackboardComponent->GetValueAsObject("TargetActor"));
```

### 3.4 Blackboard 观察者（Observers）

Blackboard 观察者可以在值改变时触发事件。

```cpp
// 在 AI Controller 中
void AMyAIController::BeginPlay()
{
    Super::BeginPlay();

    if (BlackboardComponent)
    {
        // 注册观察者
        BlackboardComponent->RegisterObserver(
            "HasTarget",
            this,
            FOnBlackboardChangeNotification::CreateUObject(this, &AMyAIController::OnTargetChanged)
        );
    }
}

void AMyAIController::OnTargetChanged(const UBlackboardComponent& Blackboard, FBlackboard::FKey ChangedKeyID)
{
    // 当 HasTarget 改变时调用
    bool bHasTarget = BlackboardComponent->GetValueAsBool("HasTarget");
    if (bHasTarget)
    {
        UE_LOG(LogTemp, Warning, TEXT("Target acquired!"));
    }
    else
    {
        UE_LOG(LogTemp, Warning, TEXT("Target lost!"));
    }
}
```

## 4. Behavior Tree（行为树）

### 4.1 什么是 Behavior Tree

**Behavior Tree（行为树）** 是定义 AI 行为逻辑的节点树结构。它使用节点来表示不同的行为，通过组合节点来创建复杂的 AI 行为。

**通俗理解：**

想象行为树是一个决策树：
- 根节点：开始执行
- 选择器（Selector）：尝试执行子节点，直到有一个成功
- 序列（Sequence）：依次执行所有子节点，直到有一个失败
- 任务节点：执行具体的行为（移动、攻击等）

### 4.2 创建 Behavior Tree

**步骤 1：创建 Behavior Tree 资源**

1. 在内容浏览器中右键点击
2. 选择 `Artificial Intelligence > Behavior Tree`
3. 命名并创建（例如：`BT_EnemyAI`）
4. 选择对应的 Blackboard

**步骤 2：添加节点**

在 Behavior Tree 编辑器中：

1. **根节点**：自动创建，不能删除
2. **Composite 节点**：
   - **Selector**：选择器，尝试执行子节点直到成功
   - **Sequence**：序列，依次执行所有子节点
   - **Simple Parallel**：简单并行，同时执行多个任务

3. **Decorator 节点**：装饰器，修改节点的执行条件
   - **Blackboard**：检查 Blackboard 值
   - **Time Limit**：时间限制
   - **Cooldown**：冷却时间

4. **Service 节点**：服务，在节点执行期间定期执行
   - **Default Focus**：设置默认焦点
   - **Run Behavior**：运行子行为树

5. **Task 节点**：任务，执行具体行为
   - **Move To**：移动到位置
   - **Wait**：等待
   - **Rotate to Face BB Entry**：转向 Blackboard 中的目标

### 4.3 基础 Behavior Tree 示例

**简单的巡逻 Behavior Tree：**

```
Root
└── Selector (巡逻或追击)
    ├── Sequence (追击玩家)
    │   ├── Decorator: Blackboard (HasTarget == true)
    │   └── Task: Move To (TargetLocation)
    └── Sequence (巡逻)
        ├── Task: Move To (PatrolPoint)
        └── Task: Wait (5秒)
```

**创建步骤：**

1. 添加 **Selector** 节点作为根节点的子节点
2. 添加 **Sequence** 节点作为 Selector 的第一个子节点
3. 添加 **Blackboard Decorator**，检查 `HasTarget`
4. 添加 **Move To** 任务，目标设置为 `TargetLocation`
5. 添加另一个 **Sequence** 节点作为 Selector 的第二个子节点
6. 添加 **Move To** 任务，目标设置为 `PatrolPoint`
7. 添加 **Wait** 任务，等待 5 秒

### 4.4 自定义 Task 节点

创建自定义任务节点，实现特定的 AI 行为。

```cpp
// BTTask_Attack.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/Tasks/BTTaskNode.h"
#include "BTTask_Attack.generated.h"

UCLASS()
class MYGAME_API UBTTask_Attack : public UBTTaskNode
{
    GENERATED_BODY()

public:
    UBTTask_Attack();

    virtual EBTNodeResult::Type ExecuteTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) override;

protected:
    // 攻击完成回调
    void OnAttackFinished();

private:
    // 攻击目标
    AActor* TargetActor = nullptr;
};

// BTTask_Attack.cpp
#include "BTTask_Attack.h"
#include "BehaviorTree/BehaviorTreeComponent.h"
#include "AIController.h"
#include "GameFramework/Character.h"
#include "Components/SkeletalMeshComponent.h"
#include "Animation/AnimMontage.h"

UBTTask_Attack::UBTTask_Attack()
{
    NodeName = TEXT("Attack");
    bNotifyTick = false;
    bNotifyTaskFinished = true;
}

EBTNodeResult::Type UBTTask_Attack::ExecuteTask(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory)
{
    AAIController* AIController = OwnerComp.GetAIOwner();
    if (!AIController)
    {
        return EBTNodeResult::Failed;
    }

    APawn* ControlledPawn = AIController->GetPawn();
    if (!ControlledPawn)
    {
        return EBTNodeResult::Failed;
    }

    // 从 Blackboard 获取目标
    UBlackboardComponent* BlackboardComp = OwnerComp.GetBlackboardComponent();
    if (!BlackboardComp)
    {
        return EBTNodeResult::Failed;
    }

    TargetActor = Cast<AActor>(BlackboardComp->GetValueAsObject("TargetActor"));
    if (!TargetActor)
    {
        return EBTNodeResult::Failed;
    }

    // 执行攻击（这里假设角色有攻击动画）
    ACharacter* Character = Cast<ACharacter>(ControlledPawn);
    if (Character)
    {
        // 播放攻击动画
        // UAnimMontage* AttackMontage = ...;
        // Character->PlayAnimMontage(AttackMontage);
        
        UE_LOG(LogTemp, Warning, TEXT("AI is attacking!"));
        
        // 这里可以添加实际的攻击逻辑
        // 例如：造成伤害、播放特效等
        
        // 如果攻击是即时的，直接返回成功
        return EBTNodeResult::Succeeded;
        
        // 如果攻击需要时间，返回 InProgress，并在完成后调用 FinishLatentTask
        // return EBTNodeResult::InProgress;
    }

    return EBTNodeResult::Failed;
}
```

### 4.5 自定义 Decorator 节点

创建自定义装饰器，实现复杂的条件判断。

```cpp
// BTDecorator_HealthCheck.h
#pragma once

#include "CoreMinimal.h"
#include "BehaviorTree/Decorators/BTDecorator.h"
#include "BTDecorator_HealthCheck.generated.h"

UCLASS()
class MYGAME_API UBTDecorator_HealthCheck : public UBTDecorator
{
    GENERATED_BODY()

public:
    UBTDecorator_HealthCheck();

    virtual bool CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const override;

protected:
    // 最小生命值（低于此值返回 false）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Health")
    float MinHealth = 30.0f;
};

// BTDecorator_HealthCheck.cpp
#include "BTDecorator_HealthCheck.h"
#include "BehaviorTree/BehaviorTreeComponent.h"
#include "AIController.h"
#include "GameFramework/Pawn.h"
#include "Components/HealthComponent.h" // 假设有生命值组件

UBTDecorator_HealthCheck::UBTDecorator_HealthCheck()
{
    NodeName = TEXT("Health Check");
    bNotifyActivation = true;
}

bool UBTDecorator_HealthCheck::CalculateRawConditionValue(UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) const
{
    AAIController* AIController = OwnerComp.GetAIOwner();
    if (!AIController)
    {
        return false;
    }

    APawn* ControlledPawn = AIController->GetPawn();
    if (!ControlledPawn)
    {
        return false;
    }

    // 检查生命值（这里假设有生命值组件）
    // UHealthComponent* HealthComp = ControlledPawn->FindComponentByClass<UHealthComponent>();
    // if (HealthComp)
    // {
    //     return HealthComp->GetHealth() >= MinHealth;
    // }

    // 简化示例：总是返回 true
    return true;
}
```

## 5. 感知系统（Perception System）

### 5.1 什么是感知系统

**感知系统（Perception System）** 是 AI 的"感官"，用于检测周围环境。它可以检测视觉、听觉、伤害等刺激，并更新 Blackboard 数据。

**感知类型：**

1. **Sight（视觉）**：检测视野内的物体
2. **Hearing（听觉）**：检测声音
3. **Damage（伤害）**：检测受到的伤害
4. **Team（团队）**：检测团队成员
5. **Prediction（预测）**：预测目标位置

### 5.2 设置感知系统

**步骤 1：在 AI Controller 中添加感知组件**

```cpp
// 在 AI Controller 构造函数中
PerceptionComponent = CreateDefaultSubobject<UAIPerceptionComponent>(TEXT("PerceptionComponent"));
SightPerceptionComponent = CreateDefaultSubobject<UAISightPerceptionComponent>(TEXT("SightPerceptionComponent"));
```

**步骤 2：配置感知设置**

1. 创建 **AIPerception Stimuli Source** 组件（在需要被感知的 Actor 上）
2. 配置感知范围、角度等参数

**步骤 3：绑定感知事件**

```cpp
// MyAIController.h
protected:
    // 感知更新事件
    UFUNCTION()
    void OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors);

// MyAIController.cpp
void AMyAIController::BeginPlay()
{
    Super::BeginPlay();

    if (PerceptionComponent)
    {
        // 绑定感知更新事件
        PerceptionComponent->OnPerceptionUpdated.AddDynamic(this, &AMyAIController::OnPerceptionUpdated);
    }
}

void AMyAIController::OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors)
{
    for (AActor* Actor : UpdatedActors)
    {
        // 检查感知到的 Actor
        FActorPerceptionInfo PerceptionInfo;
        if (PerceptionComponent->GetActorsPerception(Actor, PerceptionInfo))
        {
            // 检查是否通过视觉感知
            if (PerceptionInfo.LastSensedStimuli.Num() > 0)
            {
                for (const FAIStimulus& Stimulus : PerceptionInfo.LastSensedStimuli)
                {
                    if (Stimulus.Type.Name == "Default__AISightSense")
                    {
                        if (Stimulus.WasSuccessfullySensed())
                        {
                            // 看到目标
                            UE_LOG(LogTemp, Warning, TEXT("Detected: %s"), *Actor->GetName());
                            
                            // 更新 Blackboard
                            if (BlackboardComponent)
                            {
                                BlackboardComponent->SetValueAsObject("TargetActor", Actor);
                                BlackboardComponent->SetValueAsBool("HasTarget", true);
                                BlackboardComponent->SetValueAsVector("TargetLocation", Actor->GetActorLocation());
                            }
                        }
                        else
                        {
                            // 失去目标
                            UE_LOG(LogTemp, Warning, TEXT("Lost sight of: %s"), *Actor->GetName());
                            
                            // 更新 Blackboard
                            if (BlackboardComponent)
                            {
                                BlackboardComponent->SetValueAsObject("TargetActor", nullptr);
                                BlackboardComponent->SetValueAsBool("HasTarget", false);
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### 5.3 配置感知参数

在 AI Controller 的 `Details` 面板中配置感知参数：

- **Sight Radius**：视野半径
- **Sight Angle**：视野角度
- **Lose Sight Radius**：失去视野半径
- **Hearing Range**：听觉范围

或在代码中配置：

```cpp
void AMyAIController::ConfigurePerception()
{
    if (SightPerceptionComponent)
    {
        // 设置视野半径
        SightPerceptionComponent->SightRadius = 2000.0f;
        
        // 设置视野角度（度）
        SightPerceptionComponent->PeripheralVisionAngleDegrees = 90.0f;
        
        // 设置失去视野半径
        SightPerceptionComponent->LoseSightRadius = 2500.0f;
        
        // 设置检测间隔
        SightPerceptionComponent->SetMaxAge(5.0f);
    }
}
```

## 6. EQS（环境查询系统）

### 6.1 什么是 EQS

**EQS（Environment Query System，环境查询系统）** 用于查询环境中的最佳位置。它可以根据多个条件（距离、可见性、安全性等）评估位置，返回最优位置。

**应用场景：**
- 寻找掩体
- 寻找攻击位置
- 寻找逃跑路线
- 寻找集合点

### 6.2 创建 EQS 查询

**步骤 1：创建 EQS 查询资源**

1. 在内容浏览器中右键点击
2. 选择 `Artificial Intelligence > Environment Query`
3. 命名并创建（例如：`EQS_FindCover`）

**步骤 2：添加生成器（Generator）**

生成器定义在哪里生成测试点：

- **Points: Circle**：在圆形区域内生成点
- **Points: Grid**：在网格中生成点
- **Points: Pathing Grid**：在导航网格上生成点
- **Actors Of Class**：在特定 Actor 周围生成点

**步骤 3：添加测试（Tests）**

测试评估每个点的质量：

- **Distance**：距离测试
- **Dot**：方向测试
- **Trace**：射线检测测试
- **Overlap**：重叠测试
- **Pathfinding**：路径查找测试

### 6.3 在代码中使用 EQS

```cpp
// MyAIController.h
public:
    // 使用 EQS 查找位置
    UFUNCTION(BlueprintCallable, Category = "AI")
    FVector FindBestLocation(UEnvQuery* QueryTemplate, FVector QueryLocation);

// MyAIController.cpp
#include "EnvironmentQuery/EnvQueryManager.h"

FVector AMyAIController::FindBestLocation(UEnvQuery* QueryTemplate, FVector QueryLocation)
{
    if (!QueryTemplate)
    {
        return FVector::ZeroVector;
    }

    // 创建查询请求
    FEnvQueryRequest QueryRequest(QueryTemplate, this);
    QueryRequest.SetFloatParam("Distance", 1000.0f); // 设置查询参数

    // 执行查询
    FEnvQueryRequest::FQueryFinishedSignature OnQueryFinished;
    OnQueryFinished.BindLambda([this](TSharedPtr<FEnvQueryResult> Result)
    {
        if (Result->IsSuccessful())
        {
            // 获取最佳位置
            FVector BestLocation = Result->GetItemAsLocation(0);
            UE_LOG(LogTemp, Warning, TEXT("Best location found: %s"), *BestLocation.ToString());
            
            // 更新 Blackboard
            if (BlackboardComponent)
            {
                BlackboardComponent->SetValueAsVector("BestLocation", BestLocation);
            }
        }
    });

    QueryRequest.Execute(EEnvQueryRunMode::SingleResult, OnQueryFinished);

    return FVector::ZeroVector; // 异步查询，这里返回零向量
}
```

### 6.4 EQS 实际应用：寻找掩体

创建一个 EQS 查询来寻找掩体：

1. **生成器**：使用 `Points: Pathing Grid`，在 AI 周围生成点
2. **测试 1**：`Trace` - 检查从 AI 到点的路径是否被阻挡（有掩体）
3. **测试 2**：`Distance` - 优先选择较近的掩体
4. **测试 3**：`Trace` - 检查从掩体到目标的视线是否被阻挡

## 7. 实际应用场景

### 7.1 场景 1：完整的敌人 AI

实现一个完整的敌人 AI，包括巡逻、发现玩家、追击、攻击等行为。

```cpp
// EnemyAIController.h
UCLASS()
class MYGAME_API AEnemyAIController : public AMyAIController
{
    GENERATED_BODY()

public:
    AEnemyAIController();

protected:
    virtual void BeginPlay() override;

    // 感知更新
    virtual void OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors) override;

private:
    // 巡逻点
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    TArray<FVector> PatrolPoints;

    // 当前巡逻点索引
    int32 CurrentPatrolIndex = 0;

    // 移动到下一个巡逻点
    void MoveToNextPatrolPoint();
};

// EnemyAIController.cpp
void AEnemyAIController::BeginPlay()
{
    Super::BeginPlay();

    // 初始化巡逻
    if (PatrolPoints.Num() > 0)
    {
        if (BlackboardComponent)
        {
            BlackboardComponent->SetValueAsVector("PatrolPoint", PatrolPoints[0]);
            BlackboardComponent->SetValueAsBool("IsPatrolling", true);
        }
    }
}

void AEnemyAIController::OnPerceptionUpdated(const TArray<AActor*>& UpdatedActors)
{
    Super::OnPerceptionUpdated(UpdatedActors);

    // 检查是否看到玩家
    for (AActor* Actor : UpdatedActors)
    {
        ACharacter* PlayerCharacter = Cast<ACharacter>(Actor);
        if (PlayerCharacter && PlayerCharacter->IsPlayerControlled())
        {
            FActorPerceptionInfo PerceptionInfo;
            if (PerceptionComponent->GetActorsPerception(Actor, PerceptionInfo))
            {
                for (const FAIStimulus& Stimulus : PerceptionInfo.LastSensedStimuli)
                {
                    if (Stimulus.Type.Name == "Default__AISightSense")
                    {
                        if (Stimulus.WasSuccessfullySensed())
                        {
                            // 发现玩家，停止巡逻，开始追击
                            if (BlackboardComponent)
                            {
                                BlackboardComponent->SetValueAsObject("TargetActor", PlayerCharacter);
                                BlackboardComponent->SetValueAsBool("HasTarget", true);
                                BlackboardComponent->SetValueAsBool("IsPatrolling", false);
                            }
                        }
                        else
                        {
                            // 失去玩家，恢复巡逻
                            if (BlackboardComponent)
                            {
                                BlackboardComponent->SetValueAsObject("TargetActor", nullptr);
                                BlackboardComponent->SetValueAsBool("HasTarget", false);
                                BlackboardComponent->SetValueAsBool("IsPatrolling", true);
                                MoveToNextPatrolPoint();
                            }
                        }
                    }
                }
            }
        }
    }
}

void AEnemyAIController::MoveToNextPatrolPoint()
{
    if (PatrolPoints.Num() == 0)
    {
        return;
    }

    CurrentPatrolIndex = (CurrentPatrolIndex + 1) % PatrolPoints.Num();
    
    if (BlackboardComponent)
    {
        BlackboardComponent->SetValueAsVector("PatrolPoint", PatrolPoints[CurrentPatrolIndex]);
    }
}
```

**对应的 Behavior Tree：**

```
Root
└── Selector
    ├── Sequence (攻击玩家)
    │   ├── Decorator: Blackboard (HasTarget == true)
    │   ├── Decorator: Distance (DistanceToTarget < 200)
    │   └── Task: Attack
    ├── Sequence (追击玩家)
    │   ├── Decorator: Blackboard (HasTarget == true)
    │   └── Task: Move To (TargetLocation)
    └── Sequence (巡逻)
        ├── Decorator: Blackboard (IsPatrolling == true)
        ├── Task: Move To (PatrolPoint)
        └── Task: Wait (3秒)
```

### 7.2 场景 2：使用 EQS 寻找掩体

实现 AI 在受到攻击时寻找掩体的行为。

```cpp
// CoverSeekingAIController.h
UCLASS()
class MYGAME_API ACoverSeekingAIController : public AMyAIController
{
    GENERATED_BODY()

public:
    ACoverSeekingAIController();

protected:
    virtual void BeginPlay() override;

    // 伤害感知
    UFUNCTION()
    void OnDamageTaken(AActor* DamagedActor, float Damage, const UDamageType* DamageType, AController* InstigatedBy, AActor* DamageCauser);

public:
    // EQS 查询（寻找掩体）
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "AI")
    class UEnvQuery* FindCoverQuery;

    // 寻找掩体
    UFUNCTION(BlueprintCallable, Category = "AI")
    void SeekCover();
};

// CoverSeekingAIController.cpp
#include "CoverSeekingAIController.h"
#include "EnvironmentQuery/EnvQueryManager.h"
#include "GameFramework/DamageType.h"

ACoverSeekingAIController::ACoverSeekingAIController()
{
    PrimaryActorTick.bCanEverTick = true;
}

void ACoverSeekingAIController::BeginPlay()
{
    Super::BeginPlay();

    // 绑定伤害事件
    if (GetPawn())
    {
        GetPawn()->OnTakeAnyDamage.AddDynamic(this, &ACoverSeekingAIController::OnDamageTaken);
    }
}

void ACoverSeekingAIController::OnDamageTaken(AActor* DamagedActor, float Damage, const UDamageType* DamageType, AController* InstigatedBy, AActor* DamageCauser)
{
    // 受到伤害，寻找掩体
    if (BlackboardComponent)
    {
        BlackboardComponent->SetValueAsBool("IsUnderFire", true);
    }

    SeekCover();
}

void ACoverSeekingAIController::SeekCover()
{
    if (!FindCoverQuery || !GetPawn())
    {
        return;
    }

    // 创建查询请求
    FEnvQueryRequest QueryRequest(FindCoverQuery, this);
    
    // 设置查询位置（AI 当前位置）
    QueryRequest.SetFloatParam("Distance", 500.0f);

    // 执行查询
    QueryRequest.Execute(EEnvQueryRunMode::SingleResult, [this](TSharedPtr<FEnvQueryResult> Result)
    {
        if (Result->IsSuccessful() && Result->Items.Num() > 0)
        {
            // 获取最佳掩体位置
            FVector CoverLocation = Result->GetItemAsLocation(0);
            
            UE_LOG(LogTemp, Warning, TEXT("Cover found at: %s"), *CoverLocation.ToString());

            // 更新 Blackboard 并移动到掩体
            if (BlackboardComponent)
            {
                BlackboardComponent->SetValueAsVector("CoverLocation", CoverLocation);
            }

            // 移动到掩体
            MoveToLocation(CoverLocation);
        }
    });
}
```

## 8. 性能优化

### 8.1 Behavior Tree 优化

**问题：** 复杂的 Behavior Tree 可能影响性能。

**优化方法：**

1. **减少节点数量**：
   - 合并相似的任务
   - 使用 Service 节点代替重复的检查

2. **使用 Decorator 提前退出**：
   - 使用 Decorator 快速失败
   - 避免执行不必要的任务

3. **优化 Service 节点频率**：
   - 不要每帧都执行 Service
   - 使用合理的更新间隔

### 8.2 感知系统优化

**问题：** 感知系统每帧检测可能影响性能。

**优化方法：**

1. **调整感知频率**：
   - 在 AI Controller 中设置感知更新频率
   - 不要每帧都更新

2. **限制感知范围**：
   - 使用合理的感知半径
   - 避免过大的感知范围

3. **使用感知刺激源过滤**：
   - 只感知需要的 Actor 类型
   - 使用感知配置过滤

```cpp
void AMyAIController::OptimizePerception()
{
    if (SightPerceptionComponent)
    {
        // 设置感知配置
        FAISenseAffiliationFilter AffiliationFilter;
        AffiliationFilter.bDetectEnemies = true;
        AffiliationFilter.bDetectFriendlies = false;
        AffiliationFilter.bDetectNeutrals = false;

        SightPerceptionComponent->SetSenseAffiliationFilter(AffiliationFilter);
    }
}
```

### 8.3 EQS 优化

**问题：** EQS 查询可能很耗时。

**优化方法：**

1. **限制生成点数量**：
   - 使用合理的生成器设置
   - 避免生成过多测试点

2. **使用异步查询**：
   - 对于非关键查询，使用异步模式
   - 避免阻塞游戏线程

3. **缓存查询结果**：
   - 如果查询条件不变，缓存结果
   - 只在必要时重新查询

## 9. 常见问题与最佳实践

### 9.1 常见问题

**Q: Behavior Tree 不执行？**

A: 检查以下几点：
1. AI Controller 是否正确设置了 Behavior Tree 和 Blackboard？
2. 是否调用了 `RunBehaviorTree`？
3. Behavior Tree 的根节点是否正确连接？

**Q: 感知系统不工作？**

A: 检查以下几点：
1. 是否添加了感知组件？
2. 目标 Actor 是否有 `AIPerceptionStimuliSourceComponent`？
3. 感知范围是否合理？
4. 是否绑定了感知事件？

**Q: Blackboard 值不更新？**

A: 检查以下几点：
1. Blackboard 是否正确初始化？
2. Key 名称是否正确？
3. 值类型是否匹配？

**Q: EQS 查询失败？**

A: 检查以下几点：
1. EQS 查询资源是否正确设置？
2. 生成器是否生成了点？
3. 测试条件是否太严格？

### 9.2 最佳实践

1. **合理组织 Behavior Tree**：
   - 使用清晰的节点命名
   - 合理使用 Selector 和 Sequence
   - 避免过深的树结构

2. **有效使用 Blackboard**：
   - 使用有意义的 Key 名称
   - 合理组织数据
   - 使用观察者处理值变化

3. **优化感知系统**：
   - 使用合理的感知范围
   - 配置感知过滤
   - 避免过度检测

4. **合理使用 EQS**：
   - 只在需要时使用
   - 优化查询参数
   - 缓存查询结果

5. **测试和调试**：
   - 使用 Behavior Tree 调试工具
   - 可视化 Blackboard 值
   - 使用 EQS 测试工具

## 10. 总结

本文从零开始全面介绍了 UE5 的 AI 系统，包括：

1. **AI 系统概述**：核心组件和工作流程
2. **AI Controller**：AI 控制器的创建和使用
3. **Blackboard**：数据存储和共享
4. **Behavior Tree**：行为逻辑的定义和执行
5. **感知系统**：环境检测和刺激响应
6. **EQS**：环境查询和位置选择
7. **实际应用**：完整的敌人 AI、掩体寻找等场景
8. **性能优化**：Behavior Tree、感知系统、EQS 优化
9. **最佳实践**：常见问题的解决方案和开发建议

AI 系统是 UE5 游戏开发的核心功能，掌握它能够创建各种复杂的 AI 行为。通过本文的学习，你应该能够：

- 理解 AI 系统的核心组件
- 创建和使用 AI Controller
- 设置和使用 Blackboard
- 创建和执行 Behavior Tree
- 配置感知系统
- 使用 EQS 查询环境
- 实现完整的 AI 行为
- 优化 AI 系统性能
- 解决常见的 AI 问题

希望这篇文章能帮助你快速掌握 UE5 的 AI 系统！
